import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  ENABLE_CLOUD_FUNCTIONS,
  auth,
  db,
  functions,
  handleFirestoreError,
  OperationType,
  toIsoString,
  toNullableIsoString,
} from './firebase';
import {
  fetchImagesByProductIds,
  fetchLookupMaps,
  fetchProfilesMap,
  hydrateProductDoc,
} from './firestoreHelpers';
import type {
  ExchangeConfirmation,
  ExchangeRecord,
  MatchRecord,
  Product,
  ProductModality,
  Review,
  TreeStage,
} from '../types/domain';

function computeTreeStage(operations: number): TreeStage {
  if (operations >= 15) return 'arbol_frutal';
  if (operations >= 9) return 'arbol_desarrollado';
  if (operations >= 5) return 'arbol_joven';
  if (operations >= 2) return 'brote';
  return 'semilla';
}

export async function listUserExchanges(userId: string): Promise<ExchangeRecord[]> {
  try {
    const [asOwnerSnap, asRequesterSnap] = await Promise.all([
      getDocs(query(collection(db, 'exchanges'), where('owner_id', '==', userId))),
      getDocs(query(collection(db, 'exchanges'), where('requester_id', '==', userId))),
    ]);

    const exMap = new Map<string, (typeof asOwnerSnap.docs)[number]>();
    asOwnerSnap.docs.forEach((d) => exMap.set(d.id, d));
    asRequesterSnap.docs.forEach((d) => exMap.set(d.id, d));
    if (exMap.size === 0) return [];

    const exDocs = Array.from(exMap.values());
    const matchIds = Array.from(
      new Set(exDocs.map((d) => String(d.data().match_id || '')).filter(Boolean))
    );

    const matchSnaps = await Promise.all(
      matchIds.map((mid) => getDoc(doc(db, 'matches', mid)).catch(() => null))
    );
    const productIds: string[] = [];
    const userIds: string[] = [];
    matchSnaps.forEach((mSnap) => {
      if (!mSnap?.exists()) return;
      const md = mSnap.data();
      if (md.target_product_id) productIds.push(String(md.target_product_id));
      if (md.offered_product_id) productIds.push(String(md.offered_product_id));
      if (md.owner_id) userIds.push(String(md.owner_id));
      if (md.requester_id) userIds.push(String(md.requester_id));
    });

    const [maps, profiles, images, productSnaps, confOwnerSnap, confReqSnap] = await Promise.all([
      fetchLookupMaps(),
      fetchProfilesMap(userIds),
      fetchImagesByProductIds(productIds),
      Promise.all(
        Array.from(new Set(productIds)).map((pid) =>
          getDoc(doc(db, 'products', pid)).catch(() => null)
        )
      ),
      getDocs(query(collection(db, 'exchange_confirmations'), where('owner_id', '==', userId))).catch(
        () => null
      ),
      getDocs(
        query(collection(db, 'exchange_confirmations'), where('requester_id', '==', userId))
      ).catch(() => null),
    ]);

    const productMap = new Map<string, Product>();
    productSnaps.forEach((pSnap) => {
      if (pSnap?.exists()) {
        productMap.set(
          pSnap.id,
          hydrateProductDoc(pSnap.id, pSnap.data(), { ...maps, profiles, images })
        );
      }
    });

    const matchMap = new Map<string, MatchRecord>();
    matchSnaps.forEach((mSnap) => {
      if (!mSnap?.exists()) return;
      const md = mSnap.data();
      matchMap.set(mSnap.id, {
        id: mSnap.id,
        request_id: String(md.request_id || ''),
        target_product_id: String(md.target_product_id || ''),
        offered_product_id: md.offered_product_id ? String(md.offered_product_id) : null,
        owner_id: String(md.owner_id || ''),
        requester_id: String(md.requester_id || ''),
        modality: md.modality as ProductModality,
        quantity_reserved: Number(md.quantity_reserved ?? 1),
        status: md.status,
        created_at: toIsoString(md.created_at),
        target_product: productMap.get(String(md.target_product_id || '')) ?? null,
        offered_product: md.offered_product_id
          ? productMap.get(String(md.offered_product_id)) ?? null
          : null,
        owner: profiles.get(String(md.owner_id || '')) ?? null,
        requester: profiles.get(String(md.requester_id || '')) ?? null,
      });
    });

    const confByExchange = new Map<string, ExchangeConfirmation[]>();
    const seenConfIds = new Set<string>();
    [confOwnerSnap, confReqSnap].forEach((snap) => {
      snap?.docs.forEach((c) => {
        if (seenConfIds.has(c.id)) return;
        seenConfIds.add(c.id);
        const cd = c.data();
        const exId = String(cd.exchange_id || '');
        if (!exId) return;
        const list = confByExchange.get(exId) ?? [];
        list.push({
          id: c.id,
          exchange_id: exId,
          user_id: String(cd.user_id || ''),
          confirmed_at: toIsoString(cd.confirmed_at),
          notes: cd.notes ? String(cd.notes) : null,
        });
        confByExchange.set(exId, list);
      });
    });

    return exDocs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          match_id: String(data.match_id || ''),
          status: data.status,
          proposed_date: data.proposed_date ? String(data.proposed_date) : null,
          proposed_time_slot: data.proposed_time_slot ? String(data.proposed_time_slot) : null,
          meeting_point_label: data.meeting_point_label
            ? String(data.meeting_point_label)
            : null,
          meeting_point_lat:
            typeof data.meeting_point_lat === 'number' ? data.meeting_point_lat : null,
          meeting_point_lng:
            typeof data.meeting_point_lng === 'number' ? data.meeting_point_lng : null,
          proposed_by: data.proposed_by ? String(data.proposed_by) : null,
          cancelled_by: data.cancelled_by ? String(data.cancelled_by) : null,
          cancellation_reason: data.cancellation_reason
            ? String(data.cancellation_reason)
            : null,
          completed_at: toNullableIsoString(data.completed_at),
          created_at: toIsoString(data.created_at),
          matches: matchMap.get(String(data.match_id || '')) ?? null,
          exchange_confirmations: confByExchange.get(d.id) ?? [],
        } satisfies ExchangeRecord;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'exchanges');
  }
}

export async function proposeExchangeDelivery(params: {
  exchangeId: string;
  proposedBy: string;
  proposedDate: string;
  proposedTimeSlot: string;
  meetingPointLabel: string;
  meetingPointLat?: number | null;
  meetingPointLng?: number | null;
  agreed?: boolean;
}): Promise<void> {
  try {
    await updateDoc(doc(db, 'exchanges', params.exchangeId), {
      proposed_by: params.proposedBy,
      proposed_date: params.proposedDate,
      proposed_time_slot: params.proposedTimeSlot,
      meeting_point_label: params.meetingPointLabel.trim(),
      meeting_point_lat: params.meetingPointLat ?? null,
      meeting_point_lng: params.meetingPointLng ?? null,
      status: params.agreed ? 'delivery_agreed' : 'coordinating',
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `exchanges/${params.exchangeId}`);
  }
}

const ALLOWED_EXCHANGE_KEYS = new Set([
  'id',
  'match_id',
  'owner_id',
  'requester_id',
  'status',
  'proposed_date',
  'proposed_time_slot',
  'meeting_point_label',
  'meeting_point_lat',
  'meeting_point_lng',
  'proposed_by',
  'cancelled_by',
  'cancellation_reason',
  'completed_at',
  'created_at',
  'updated_at',
]);

function classifyFirestoreFailure(error: unknown): {
  category: 'FIRESTORE_RULES_PERMISSION_DENIED' | 'TRANSACTION_STATE_ERROR' | 'UNKNOWN_ERROR';
  code: string | null;
  message: string;
} {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : null;
  const message = error instanceof Error ? error.message : String(error);

  if (
    code === 'permission-denied' ||
    message.includes('permission-denied') ||
    message.includes('Missing or insufficient permissions')
  ) {
    return {
      category: 'FIRESTORE_RULES_PERMISSION_DENIED',
      code: code ?? 'permission-denied',
      message,
    };
  }

  if (
    code === 'failed-precondition' ||
    code === 'aborted' ||
    code === 'not-found' ||
    code === 'already-exists' ||
    message.includes('Intercambio no encontrado') ||
    message.includes('No perteneces')
  ) {
    return {
      category: 'TRANSACTION_STATE_ERROR',
      code: code ?? 'state-error',
      message,
    };
  }

  return {
    category: 'UNKNOWN_ERROR',
    code,
    message,
  };
}

export async function confirmExchangeDeliveryRpc(params: {
  exchangeId: string;
  notes?: string;
  measuredWeightKg?: number | null;
}): Promise<ExchangeRecord> {
  const debugTrace: Record<string, unknown> = {
    exchangeId: params.exchangeId,
    enableCloudFunctions: ENABLE_CLOUD_FUNCTIONS,
    uid: auth.currentUser?.uid ?? null,
    emailVerified: auth.currentUser?.emailVerified ?? null,
    providers: auth.currentUser?.providerData.map((p) => p.providerId) ?? [],
  };

  console.info('[ConfirmDeliveryDebug] 1.auth_context', debugTrace);

  if (ENABLE_CLOUD_FUNCTIONS) {
    try {
      const fn = httpsCallable(functions, 'confirmExchangeDelivery');
      await fn(params);
      const snap = await getDoc(doc(db, 'exchanges', params.exchangeId));
      const d = snap.data() ?? {};
      console.info('[ConfirmDeliveryDebug] cloud_function_completed', {
        exchangeId: params.exchangeId,
        status: d.status,
      });
      return {
        id: snap.id,
        match_id: String(d.match_id || ''),
        status: (d.status as ExchangeRecord['status']) || 'completed',
        proposed_date: d.proposed_date ? String(d.proposed_date) : null,
        proposed_time_slot: d.proposed_time_slot ? String(d.proposed_time_slot) : null,
        meeting_point_label: d.meeting_point_label ? String(d.meeting_point_label) : null,
        meeting_point_lat: typeof d.meeting_point_lat === 'number' ? d.meeting_point_lat : null,
        meeting_point_lng: typeof d.meeting_point_lng === 'number' ? d.meeting_point_lng : null,
        proposed_by: d.proposed_by ? String(d.proposed_by) : null,
        cancelled_by: d.cancelled_by ? String(d.cancelled_by) : null,
        cancellation_reason: d.cancellation_reason ? String(d.cancellation_reason) : null,
        completed_at: toNullableIsoString(d.completed_at),
        created_at: toIsoString(d.created_at),
      };
    } catch (error) {
      console.error('[ConfirmDeliveryDebug] cloud_function_failed', classifyFirestoreFailure(error));
      throw error;
    }
  }

  const currentUid = auth.currentUser?.uid;
  if (!currentUid) {
    console.error('[ConfirmDeliveryDebug] auth_missing', debugTrace);
    throw new Error('Debes iniciar sesión.');
  }

  const exchangeRef = doc(db, 'exchanges', params.exchangeId);
  const myConfId = `${params.exchangeId}_${currentUid}`;
  const myConfRef = doc(db, 'exchange_confirmations', myConfId);

  let activeStage = 'tx_core_read_exchange';
  let activePath = `exchanges/${params.exchangeId}`;
  let lastExchangeSnapshot: Record<string, unknown> | null = null;
  let lastConfirmationSnapshot: Record<string, unknown> | null = null;

  try {
    // FASE 1: Confirmación y cierre atómico principal (solo exchanges + exchange_confirmations)
    // Se aíslan matches y products fuera de la transacción núcleo para evitar que un producto
    // archivado/incompleto o un match ya cerrado aborte la confirmación del usuario.
    const txContext = await runTransaction(db, async (tx) => {
      activeStage = 'tx_core_read_exchange';
      activePath = `exchanges/${params.exchangeId}`;
      const exSnap = await tx.get(exchangeRef);

      if (!exSnap.exists()) {
        console.error('[ConfirmDeliveryDebug] 2.exchange_not_found', {
          exchangeId: params.exchangeId,
          currentUid,
        });
        throw new Error('Intercambio no encontrado.');
      }

      const ex = exSnap.data();
      const exKeys = Object.keys(ex);
      const unexpectedKeys = exKeys.filter((k) => !ALLOWED_EXCHANGE_KEYS.has(k));
      const missingRequiredKeys = ['id', 'match_id', 'owner_id', 'requester_id', 'status', 'created_at'].filter(
        (k) => !(k in ex) || ex[k] === undefined || ex[k] === null
      );

      const ownerId = String(ex.owner_id || '');
      const requesterId = String(ex.requester_id || '');
      const matchId = String(ex.match_id || '').trim();

      lastExchangeSnapshot = {
        docId: exSnap.id,
        dataId: ex.id ?? null,
        idMatchesDocId: ex.id === exSnap.id,
        status: ex.status ?? null,
        ownerId,
        requesterId,
        currentUid,
        isOwner: ownerId === currentUid,
        isRequester: requesterId === currentUid,
        matchId,
        hasCreatedAt: Boolean(ex.created_at),
        unexpectedKeys,
        missingRequiredKeys,
      };

      console.info('[ConfirmDeliveryDebug] 2.pre_read_exchange', lastExchangeSnapshot);

      if (ownerId !== currentUid && requesterId !== currentUid) {
        throw new Error('No perteneces a este intercambio.');
      }

      if (['completed', 'cancelled'].includes(String(ex.status || ''))) {
        console.info('[ConfirmDeliveryDebug] 2b.exchange_already_closed', lastExchangeSnapshot);
        return {
          alreadyClosed: true,
          status: ex.status as ExchangeRecord['status'],
          ownerId,
          requesterId,
          otherUid: ownerId === currentUid ? requesterId : ownerId,
          matchId,
        };
      }

      activeStage = 'tx_core_read_confirmation';
      activePath = `exchange_confirmations/${myConfId}`;
      const myConfSnap = await tx.get(myConfRef);

      lastConfirmationSnapshot = {
        myConfId,
        myConfIdLength: myConfId.length,
        exists: myConfSnap.exists(),
      };
      console.info('[ConfirmDeliveryDebug] 3.pre_read_confirmation', lastConfirmationSnapshot);

      if (unexpectedKeys.length > 0 || missingRequiredKeys.length > 0 || ex.id !== exSnap.id) {
        console.warn('[ConfirmDeliveryDebug] 3b.schema_warning_on_exchange', {
          unexpectedKeys,
          missingRequiredKeys,
          idMatches: ex.id === exSnap.id,
          hint: 'Si Firestore devuelve permission-denied, revisa isValidExchange en firestore.rules frente a estos campos.',
        });
      }

      if (!myConfSnap.exists()) {
        activeStage = 'tx_core_write_confirmation';
        activePath = `exchange_confirmations/${myConfId}`;
        console.info('[ConfirmDeliveryDebug] 4a.tx_set_confirmation', {
          path: activePath,
          exchangeId: params.exchangeId,
          userId: currentUid,
          ownerId,
          requesterId,
        });
        tx.set(myConfRef, {
          id: myConfId,
          exchange_id: params.exchangeId,
          user_id: currentUid,
          owner_id: ownerId,
          requester_id: requesterId,
          confirmed_at: serverTimestamp(),
          notes: params.notes?.trim() || null,
          measured_weight_kg:
            typeof params.measuredWeightKg === 'number' && params.measuredWeightKg > 0
              ? params.measuredWeightKg
              : null,
        });
      }

      activeStage = 'tx_core_write_exchange';
      activePath = `exchanges/${params.exchangeId}`;
      console.info('[ConfirmDeliveryDebug] 4b.tx_update_exchange', {
        path: activePath,
        prevStatus: ex.status,
        nextStatus: 'completed',
      });
      tx.update(exchangeRef, {
        status: 'completed',
        completed_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });

      return {
        alreadyClosed: false,
        status: 'completed' as const,
        ownerId,
        requesterId,
        otherUid: ownerId === currentUid ? requesterId : ownerId,
        matchId,
      };
    });

    console.info('[ConfirmDeliveryDebug] 4c.tx_core_commit_ok', {
      exchangeId: params.exchangeId,
      alreadyClosed: txContext.alreadyClosed,
      status: txContext.status,
    });

    // FASE 2: Sincronización de Match y Stock de Producto (aislada, con logs independientes)
    let isGift = true;
    let qtyReserved = 1;
    let productId = '';
    let productData: Record<string, unknown> | null = null;

    if (txContext.matchId) {
      try {
        activeStage = 'post_match_sync';
        activePath = `matches/${txContext.matchId}`;
        const matchRef = doc(db, 'matches', txContext.matchId);
        const matchSnap = await getDoc(matchRef);
        if (matchSnap.exists()) {
          const match = matchSnap.data();
          isGift = match.modality !== 'exchange';
          qtyReserved = Math.max(1, Math.round(Number(match.quantity_reserved ?? 1) || 1));
          productId = String(match.target_product_id || '').trim();

          console.info('[ConfirmDeliveryDebug] 5a.post_match_read', {
            matchId: txContext.matchId,
            status: match.status,
            modality: match.modality,
            qtyReserved,
            productId,
          });

          if (!txContext.alreadyClosed && match.status === 'active') {
            await updateDoc(matchRef, {
              status: 'completed',
              updated_at: serverTimestamp(),
            });
            console.info('[ConfirmDeliveryDebug] 5b.post_match_update_ok', {
              matchId: txContext.matchId,
            });
          }
        }
      } catch (matchErr) {
        console.warn('[ConfirmDeliveryDebug] 5c.post_match_sync_failed', {
          matchId: txContext.matchId,
          ...classifyFirestoreFailure(matchErr),
        });
      }
    }

    if (productId) {
      try {
        activeStage = 'post_product_sync';
        activePath = `products/${productId}`;
        const productRef = doc(db, 'products', productId);
        const productSnap = await getDoc(productRef);
        if (productSnap.exists()) {
          const product = productSnap.data();
          productData = product;

          console.info('[ConfirmDeliveryDebug] 6a.post_product_read', {
            productId,
            status: product.status,
            available_quantity: product.available_quantity,
            reserved_quantity: product.reserved_quantity,
            total_quantity: product.total_quantity,
          });

          if (!txContext.alreadyClosed && product.status !== 'completed') {
            const prevAvail = Math.max(0, Math.round(Number(product.available_quantity ?? 0)));
            const prevTotal = Math.max(1, Math.round(Number(product.total_quantity ?? prevAvail + qtyReserved)));
            const nextReserved = Math.max(
              0,
              Math.min(prevTotal - prevAvail, Math.round(Number(product.reserved_quantity ?? 0)) - qtyReserved)
            );
            const nextProdStatus =
              prevAvail === 0 && nextReserved === 0
                ? 'completed'
                : nextReserved > 0
                  ? 'reserved'
                  : 'approved';

            await updateDoc(productRef, {
              reserved_quantity: nextReserved,
              status: nextProdStatus,
              sync_exchange_id: params.exchangeId,
              updated_at: serverTimestamp(),
            });
            console.info('[ConfirmDeliveryDebug] 6b.post_product_update_ok', {
              productId,
              nextReserved,
              nextProdStatus,
            });
          }
        }
      } catch (prodErr) {
        console.warn('[ConfirmDeliveryDebug] 6c.post_product_sync_failed', {
          productId,
          ...classifyFirestoreFailure(prodErr),
        });
      }
    }

    // FASE 3: Efectos posteriores no bloqueantes (Árbol Circular, Logros, Impacto y Notificación)
    if (!txContext.alreadyClosed) {
      const participants = Array.from(new Set([txContext.ownerId, txContext.requesterId].filter(Boolean)));
      let achievementDocs: Array<{ id: string; reqOps: number }> = [];
      try {
        const achSnap = await getDocs(collection(db, 'achievements'));
        achievementDocs = achSnap.docs.map((d) => ({
          id: d.id,
          reqOps: Number(d.data().required_operations ?? 1),
        }));
      } catch (achListErr) {
        console.warn('[ConfirmDeliveryDebug] 7a.achievements_list_skipped', classifyFirestoreFailure(achListErr));
        achievementDocs = [];
      }

      for (const uid of participants) {
        try {
          const treeRef = doc(db, 'user_tree_progress', uid);
          const nextOps = await runTransaction(db, async (tx) => {
            const snap = await tx.get(treeRef);
            const prev = snap.exists()
              ? snap.data()
              : { completed_operations: 0, completed_gifts: 0, completed_exchanges: 0, last_exchange_id: null };
            if (prev.last_exchange_id === params.exchangeId) {
              return Number(prev.completed_operations ?? 0);
            }
            const ops = Number(prev.completed_operations ?? 0) + 1;
            tx.set(treeRef, {
              user_id: uid,
              completed_operations: ops,
              completed_gifts: Number(prev.completed_gifts ?? 0) + (isGift ? 1 : 0),
              completed_exchanges: Number(prev.completed_exchanges ?? 0) + (isGift ? 0 : 1),
              current_stage: computeTreeStage(ops),
              last_exchange_id: params.exchangeId,
              updated_at: serverTimestamp(),
            });
            return ops;
          });
          console.info('[ConfirmDeliveryDebug] 7b.post_tree_progress_ok', { uid, nextOps });

          for (const ach of achievementDocs) {
            if (nextOps >= ach.reqOps) {
              try {
                const recId = `${uid}_${ach.id}`;
                const uaRef = doc(db, 'user_achievements', recId);
                const uaSnap = await getDoc(uaRef);
                if (!uaSnap.exists()) {
                  await setDoc(uaRef, {
                    id: recId,
                    user_id: uid,
                    achievement_id: ach.id,
                    exchange_id: params.exchangeId,
                    unlocked_at: serverTimestamp(),
                  });
                }
              } catch (uaErr) {
                console.warn('[ConfirmDeliveryDebug] 7c.post_achievement_skipped', {
                  uid,
                  achievementId: ach.id,
                  ...classifyFirestoreFailure(uaErr),
                });
              }
            }
          }
        } catch (err) {
          console.warn('[ConfirmDeliveryDebug] 7d.post_tree_progress_failed', {
            uid,
            ...classifyFirestoreFailure(err),
          });
        }
      }

      if (productData) {
        try {
          const impactRef = doc(db, 'impact_records', params.exchangeId);
          const impactSnap = await getDoc(impactRef);
          if (!impactSnap.exists()) {
            const catId = String(productData.category_id || '').trim();
            const catSnap = catId ? await getDoc(doc(db, 'categories', catId)).catch(() => null) : null;
            const catWeight = catSnap?.exists() ? Number(catSnap.data().estimated_weight_kg ?? 1) : 1;
            const measured =
              typeof params.measuredWeightKg === 'number' && params.measuredWeightKg > 0
                ? params.measuredWeightKg
                : 0;
            const totalWeight =
              measured > 0 ? measured : Number((catWeight * qtyReserved).toFixed(2));

            await setDoc(impactRef, {
              id: params.exchangeId,
              exchange_id: params.exchangeId,
              product_id: String(productData.id || productId || params.exchangeId),
              category_id: catId || 'otros',
              commune_id: String(productData.commune_id || 'castro'),
              sector_id: productData.sector_id ? String(productData.sector_id) : null,
              modality: isGift ? 'gift' : 'exchange',
              quantity: qtyReserved,
              weight_kg: totalWeight,
              weight_type: measured > 0 ? 'measured' : 'estimated',
              created_at: serverTimestamp(),
            });
            console.info('[ConfirmDeliveryDebug] 8a.post_impact_record_ok', {
              exchangeId: params.exchangeId,
              totalWeight,
            });
          }
        } catch (err) {
          console.warn('[ConfirmDeliveryDebug] 8b.post_impact_record_failed', classifyFirestoreFailure(err));
        }
      }

      if (txContext.otherUid && txContext.otherUid !== currentUid) {
        try {
          const notifRef = doc(collection(db, 'notifications'));
          await setDoc(notifRef, {
            id: notifRef.id,
            user_id: txContext.otherUid,
            event_type: 'exchange_completed',
            title: '¡Entrega circular completada!',
            body: 'La entrega fue confirmada. Tu Árbol Circular creció y ya puedes dejar una reseña.',
            link_path: '/mi-arbol',
            is_read: false,
            created_at: serverTimestamp(),
          });
          console.info('[ConfirmDeliveryDebug] 9a.post_notification_ok', {
            recipient: txContext.otherUid,
          });
        } catch (err) {
          console.warn('[ConfirmDeliveryDebug] 9b.post_notification_failed', classifyFirestoreFailure(err));
        }
      }
    }

    activeStage = 'final_read_exchange';
    activePath = `exchanges/${params.exchangeId}`;
    const updatedSnap = await getDoc(exchangeRef);
    const d = updatedSnap.data() ?? {};
    console.info('[ConfirmDeliveryDebug] 10.final_exchange_state', {
      exchangeId: updatedSnap.id,
      status: d.status,
      completed_at: d.completed_at ?? null,
    });

    return {
      id: updatedSnap.id,
      match_id: String(d.match_id || ''),
      status: (d.status as ExchangeRecord['status']) || txContext.status,
      proposed_date: d.proposed_date ? String(d.proposed_date) : null,
      proposed_time_slot: d.proposed_time_slot ? String(d.proposed_time_slot) : null,
      meeting_point_label: d.meeting_point_label ? String(d.meeting_point_label) : null,
      meeting_point_lat: typeof d.meeting_point_lat === 'number' ? d.meeting_point_lat : null,
      meeting_point_lng: typeof d.meeting_point_lng === 'number' ? d.meeting_point_lng : null,
      proposed_by: d.proposed_by ? String(d.proposed_by) : null,
      cancelled_by: d.cancelled_by ? String(d.cancelled_by) : null,
      cancellation_reason: d.cancellation_reason ? String(d.cancellation_reason) : null,
      completed_at: toNullableIsoString(d.completed_at) ?? new Date().toISOString(),
      created_at: toIsoString(d.created_at),
    };
  } catch (error) {
    const failure = classifyFirestoreFailure(error);
    console.error('[ConfirmDeliveryDebug] FAILED_CORE_CONFIRMATION', {
      failingStage: activeStage,
      failingPath: activePath,
      errorCategory: failure.category,
      firebaseCode: failure.code,
      message: failure.message,
      authContext: debugTrace,
      lastExchangeSnapshot,
      lastConfirmationSnapshot,
    });
    handleFirestoreError(error, OperationType.WRITE, activePath, {
      failingStage: activeStage,
      errorCategory: failure.category,
      exchangeSnapshot: lastExchangeSnapshot,
      confirmationSnapshot: lastConfirmationSnapshot,
    });
  }
}

export async function cancelExchangeAgreementRpc(
  exchangeId: string,
  reason: string
): Promise<ExchangeRecord> {
  if (ENABLE_CLOUD_FUNCTIONS) {
    const fn = httpsCallable(functions, 'cancelExchangeAgreement');
    await fn({ exchangeId, reason });
    const snap = await getDoc(doc(db, 'exchanges', exchangeId));
    return { id: snap.id, ...(snap.data() as Omit<ExchangeRecord, 'id'>) };
  }

  const currentUid = auth.currentUser?.uid;
  if (!currentUid) throw new Error('Debes iniciar sesión.');

  const exRef = doc(db, 'exchanges', exchangeId);

  try {
    await runTransaction(db, async (tx) => {
      const exSnap = await tx.get(exRef);
      if (!exSnap.exists()) throw new Error('Intercambio no encontrado.');
      const ex = exSnap.data();

      if (ex.owner_id !== currentUid && ex.requester_id !== currentUid) {
        throw new Error('No tienes permiso para cancelar este intercambio.');
      }
      if (['completed', 'cancelled'].includes(ex.status)) {
        throw new Error('No se puede cancelar este estado.');
      }

      const matchRef = doc(db, 'matches', String(ex.match_id));
      const matchSnap = await tx.get(matchRef);
      if (!matchSnap.exists()) throw new Error('Match no encontrado.');
      const match = matchSnap.data();

      const productRef = doc(db, 'products', String(match.target_product_id));
      const productSnap = await tx.get(productRef);
      if (!productSnap.exists()) throw new Error('Producto no encontrado.');
      const product = productSnap.data();

      const qtyReserved = Number(match.quantity_reserved ?? 1);

      tx.update(exRef, {
        status: 'cancelled',
        cancelled_by: currentUid,
        cancellation_reason: reason.trim() || 'Cancelado por participante',
        updated_at: serverTimestamp(),
      });

      tx.update(matchRef, {
        status: 'cancelled',
        updated_at: serverTimestamp(),
      });

      tx.update(productRef, {
        available_quantity: Number(product.available_quantity ?? 0) + qtyReserved,
        reserved_quantity: Math.max(0, Number(product.reserved_quantity ?? 0) - qtyReserved),
        status: 'approved',
        sync_exchange_id: exchangeId,
        updated_at: serverTimestamp(),
      });

      const otherUid = ex.owner_id === currentUid ? String(ex.requester_id) : String(ex.owner_id);
      const notifRef = doc(collection(db, 'notifications'));
      tx.set(notifRef, {
        id: notifRef.id,
        user_id: otherUid,
        event_type: 'exchange_cancelled',
        title: 'Acuerdo de entrega cancelado',
        body: 'La contraparte canceló el acuerdo y el stock volvió al catálogo.',
        link_path: '/intercambios',
        is_read: false,
        created_at: serverTimestamp(),
      });
    });

    const updatedSnap = await getDoc(exRef);
    const d = updatedSnap.data()!;
    return {
      id: updatedSnap.id,
      match_id: String(d.match_id || ''),
      status: 'cancelled',
      proposed_date: d.proposed_date ? String(d.proposed_date) : null,
      proposed_time_slot: d.proposed_time_slot ? String(d.proposed_time_slot) : null,
      meeting_point_label: d.meeting_point_label ? String(d.meeting_point_label) : null,
      meeting_point_lat: typeof d.meeting_point_lat === 'number' ? d.meeting_point_lat : null,
      meeting_point_lng: typeof d.meeting_point_lng === 'number' ? d.meeting_point_lng : null,
      proposed_by: d.proposed_by ? String(d.proposed_by) : null,
      cancelled_by: currentUid,
      cancellation_reason: reason.trim(),
      completed_at: null,
      created_at: toIsoString(d.created_at),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `exchanges/${exchangeId}`);
  }
}

export async function markExchangeDispute(exchangeId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'exchanges', exchangeId), {
      status: 'disputed',
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `exchanges/${exchangeId}`);
  }
}

export async function submitExchangeReviewRpc(params: {
  exchangeId: string;
  compliance: number;
  punctuality: number;
  condition: number;
  communication: number;
  respect: number;
  comment?: string;
}): Promise<Review> {
  const currentUid = auth.currentUser?.uid;
  if (!currentUid) throw new Error('Debes iniciar sesión.');

  const reviewId = `${params.exchangeId}_${currentUid}`;
  const overall = Number(
    (
      (params.compliance +
        params.punctuality +
        params.condition +
        params.communication +
        params.respect) /
      5
    ).toFixed(2)
  );

  try {
    const reviewedUserId = await runTransaction(db, async (tx) => {
      const exSnap = await tx.get(doc(db, 'exchanges', params.exchangeId));
      if (!exSnap.exists()) throw new Error('Intercambio no encontrado.');
      const ex = exSnap.data();

      if (ex.status !== 'completed') {
        throw new Error('Solo puedes reseñar un intercambio completado bilateralmente.');
      }
      if (ex.owner_id !== currentUid && ex.requester_id !== currentUid) {
        throw new Error('No perteneces a este intercambio.');
      }

      const targetUid =
        ex.owner_id === currentUid ? String(ex.requester_id) : String(ex.owner_id);
      const targetUserRef = doc(db, 'users', targetUid);
      const targetUserSnap = await tx.get(targetUserRef);
      if (!targetUserSnap.exists()) throw new Error('Usuario evaluado no encontrado.');

      const existingRev = await tx.get(doc(db, 'reviews', reviewId));
      if (existingRev.exists()) {
        throw new Error('Ya enviaste una reseña para este intercambio.');
      }

      const uData = targetUserSnap.data();
      const prevCount = Number(uData.reputation_count ?? 0);
      const prevAvg = Number(uData.reputation_avg ?? 0);
      const nextCount = prevCount + 1;
      const nextAvg = Number(((prevAvg * prevCount + overall) / nextCount).toFixed(2));

      tx.set(doc(db, 'reviews', reviewId), {
        id: reviewId,
        exchange_id: params.exchangeId,
        reviewer_id: currentUid,
        reviewed_user_id: targetUid,
        rating_compliance: params.compliance,
        rating_punctuality: params.punctuality,
        rating_condition: params.condition,
        rating_communication: params.communication,
        rating_respect: params.respect,
        overall_rating: overall,
        comment: params.comment?.trim() || null,
        is_flagged: false,
        created_at: serverTimestamp(),
      });

      tx.update(targetUserRef, {
        reputation_avg: nextAvg,
        reputation_count: nextCount,
        last_review_id: reviewId,
        updated_at: serverTimestamp(),
      });

      return targetUid;
    });

    return {
      id: reviewId,
      exchange_id: params.exchangeId,
      reviewer_id: currentUid,
      reviewed_user_id: reviewedUserId,
      rating_compliance: params.compliance,
      rating_punctuality: params.punctuality,
      rating_condition: params.condition,
      rating_communication: params.communication,
      rating_respect: params.respect,
      overall_rating: overall,
      comment: params.comment?.trim() || null,
      is_flagged: false,
      created_at: new Date().toISOString(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `reviews/${reviewId}`);
  }
}

export async function listUserReviews(userId: string): Promise<Review[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'reviews'),
        where('reviewed_user_id', '==', userId),
        where('is_flagged', '==', false)
      )
    );
    if (snap.empty) return [];

    const reviewerIds = snap.docs.map((d) => String(d.data().reviewer_id || ''));
    const profiles = await fetchProfilesMap(reviewerIds);

    return snap.docs
      .map((d) => {
        const data = d.data();
        const prof = profiles.get(String(data.reviewer_id || ''));
        return {
          id: d.id,
          exchange_id: String(data.exchange_id || ''),
          reviewer_id: String(data.reviewer_id || ''),
          reviewed_user_id: String(data.reviewed_user_id || ''),
          rating_compliance: Number(data.rating_compliance ?? 5),
          rating_punctuality: Number(data.rating_punctuality ?? 5),
          rating_condition: Number(data.rating_condition ?? 5),
          rating_communication: Number(data.rating_communication ?? 5),
          rating_respect: Number(data.rating_respect ?? 5),
          overall_rating: Number(data.overall_rating ?? 5),
          comment: data.comment ? String(data.comment) : null,
          is_flagged: Boolean(data.is_flagged),
          created_at: toIsoString(data.created_at),
          reviewer: prof
            ? {
                id: prof.id,
                full_name: prof.full_name,
                username: prof.username,
                avatar_url: prof.avatar_url,
              }
            : null,
        };
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'reviews');
  }
}

export async function listMySubmittedReviewExchangeIds(userId: string): Promise<string[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'reviews'), where('reviewer_id', '==', userId))
    );
    return snap.docs.map((d) => String(d.data().exchange_id || ''));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'reviews');
  }
}
