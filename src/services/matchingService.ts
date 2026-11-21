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
  writeBatch,
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
import { applyExchangeCompletionSideEffects } from './exchangeService';
import {
  fetchImagesByProductIds,
  fetchLookupMaps,
  fetchProfilesMap,
  hydrateProductDoc,
} from './firestoreHelpers';
import type {
  Conversation,
  ExchangeConfirmation,
  ExchangeRecord,
  InterestDecision,
  MatchRecord,
  MatchRequest,
  Product,
  ProductModality,
} from '../types/domain';

export async function upsertProductInterest(
  productId: string,
  userId: string,
  decision: InterestDecision
): Promise<void> {
  const docId = `${userId}_${productId}`;
  try {
    await setDoc(doc(db, 'product_interests', docId), {
      id: docId,
      product_id: productId,
      user_id: userId,
      decision,
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `product_interests/${docId}`);
  }
}

export async function listUserInterests(userId: string) {
  try {
    const snap = await getDocs(
      query(collection(db, 'product_interests'), where('user_id', '==', userId))
    );
    if (snap.empty) return [];

    const maps = await fetchLookupMaps();
    const productIds = snap.docs.map((d) => String(d.data().product_id || ''));
    const productSnaps = await Promise.all(
      Array.from(new Set(productIds)).map((pid) =>
        getDoc(doc(db, 'products', pid)).catch(() => null)
      )
    );
    const images = await fetchImagesByProductIds(productIds);
    const ownerIds = productSnaps
      .filter((s): s is NonNullable<typeof s> => Boolean(s?.exists()))
      .map((s) => String(s.data()!.owner_id || ''));
    const profiles = await fetchProfilesMap(ownerIds);

    const productMap = new Map<string, Product>();
    productSnaps.forEach((pSnap) => {
      if (pSnap?.exists()) {
        productMap.set(
          pSnap.id,
          hydrateProductDoc(pSnap.id, pSnap.data(), { ...maps, profiles, images })
        );
      }
    });

    return snap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          product_id: String(data.product_id || ''),
          user_id: String(data.user_id || ''),
          decision: data.decision as InterestDecision,
          updated_at: toIsoString(data.updated_at),
          products: productMap.get(String(data.product_id || '')) ?? null,
        };
      })
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'product_interests');
  }
}

export async function createMatchRequest(params: {
  targetProductId: string;
  requesterId: string;
  ownerId: string;
  modality: ProductModality;
  offeredProductId?: string | null;
  requestedQuantity: number;
  message?: string;
}): Promise<MatchRequest> {
  const reqRef = doc(collection(db, 'match_requests'));
  const notifRef = doc(collection(db, 'notifications'));
  const safeQty = Math.max(1, Math.min(500, Math.round(Number(params.requestedQuantity) || 1)));
  const safeMessage = params.message?.trim().slice(0, 500) || null;

  try {
    const batch = writeBatch(db);
    batch.set(reqRef, {
      id: reqRef.id,
      target_product_id: params.targetProductId,
      requester_id: params.requesterId,
      owner_id: params.ownerId,
      modality: params.modality,
      offered_product_id:
        params.modality === 'exchange' ? params.offeredProductId || null : null,
      requested_quantity: safeQty,
      message: safeMessage,
      status: 'pending',
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });

    batch.set(notifRef, {
      id: notifRef.id,
      user_id: params.ownerId,
      event_type: 'match_request_received',
      title: 'Nueva solicitud circular',
      body:
        params.modality === 'gift'
          ? 'Un vecino solicitó uno de tus regalos publicados.'
          : 'Un vecino propuso un intercambio por tu publicación.',
      link_path: '/matches',
      is_read: false,
      created_at: serverTimestamp(),
    });

    await batch.commit();

    return {
      id: reqRef.id,
      target_product_id: params.targetProductId,
      requester_id: params.requesterId,
      owner_id: params.ownerId,
      modality: params.modality,
      offered_product_id:
        params.modality === 'exchange' ? params.offeredProductId || null : null,
      requested_quantity: safeQty,
      message: safeMessage,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `match_requests/${reqRef.id}`);
  }
}

export async function listMatchRequests(userId: string): Promise<MatchRequest[]> {
  try {
    const [asOwnerSnap, asRequesterSnap] = await Promise.all([
      getDocs(query(collection(db, 'match_requests'), where('owner_id', '==', userId))),
      getDocs(query(collection(db, 'match_requests'), where('requester_id', '==', userId))),
    ]);

    const docMap = new Map<string, (typeof asOwnerSnap.docs)[number]>();
    asOwnerSnap.docs.forEach((d) => docMap.set(d.id, d));
    asRequesterSnap.docs.forEach((d) => docMap.set(d.id, d));
    if (docMap.size === 0) return [];

    const docs = Array.from(docMap.values());
    const productIds: string[] = [];
    const userIds: string[] = [];
    docs.forEach((d) => {
      const data = d.data();
      if (data.target_product_id) productIds.push(String(data.target_product_id));
      if (data.offered_product_id) productIds.push(String(data.offered_product_id));
      if (data.requester_id) userIds.push(String(data.requester_id));
      if (data.owner_id) userIds.push(String(data.owner_id));
    });

    const [maps, profiles, images, productSnaps] = await Promise.all([
      fetchLookupMaps(),
      fetchProfilesMap(userIds),
      fetchImagesByProductIds(productIds),
      Promise.all(
        Array.from(new Set(productIds)).map((pid) =>
          getDoc(doc(db, 'products', pid)).catch(() => null)
        )
      ),
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

    return docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          target_product_id: String(data.target_product_id || ''),
          requester_id: String(data.requester_id || ''),
          owner_id: String(data.owner_id || ''),
          modality: data.modality as ProductModality,
          offered_product_id: data.offered_product_id ? String(data.offered_product_id) : null,
          requested_quantity: Number(data.requested_quantity ?? 1),
          message: data.message ? String(data.message) : null,
          status: data.status,
          created_at: toIsoString(data.created_at),
          target_product: productMap.get(String(data.target_product_id || '')) ?? null,
          offered_product: data.offered_product_id
            ? productMap.get(String(data.offered_product_id)) ?? null
            : null,
          requester: profiles.get(String(data.requester_id || '')) ?? null,
          owner: profiles.get(String(data.owner_id || '')) ?? null,
        } satisfies MatchRequest;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'match_requests');
  }
}

export async function acceptMatchRequestRpc(requestId: string): Promise<string> {
  if (ENABLE_CLOUD_FUNCTIONS) {
    const fn = httpsCallable<{ requestId: string }, { matchId: string }>(
      functions,
      'acceptMatchRequest'
    );
    const res = await fn({ requestId });
    return res.data.matchId;
  }

  const currentUser = auth.currentUser;
  const currentUid = currentUser?.uid;
  if (!currentUid) throw new Error('Debes iniciar sesión.');
  if (!currentUser.emailVerified) {
    throw new Error('Debes verificar tu correo electrónico antes de aceptar una solicitud.');
  }

  const reqRef = doc(db, 'match_requests', requestId);

  try {
    const txResult = await runTransaction(db, async (tx) => {
      const reqSnap = await tx.get(reqRef);
      if (!reqSnap.exists()) throw new Error('Solicitud no encontrada.');
      const reqData = reqSnap.data();

      if (reqData.owner_id !== currentUid) {
        throw new Error('Solo quien publicó el producto puede aceptar la solicitud.');
      }
      if (!['pending', 'chat_requested'].includes(reqData.status)) {
        throw new Error('La solicitud ya fue procesada.');
      }

      const productRef = doc(db, 'products', String(reqData.target_product_id));
      const productSnap = await tx.get(productRef);
      if (!productSnap.exists()) throw new Error('Publicación no encontrada.');
      const prod = productSnap.data();

      const qty = Math.max(1, Math.round(Number(reqData.requested_quantity ?? 1)));
      if (prod.status !== 'approved' || Number(prod.available_quantity) < qty) {
        throw new Error('No queda suficiente cantidad disponible para completar el intercambio.');
      }

      const nextAvailable = Math.max(0, Number(prod.available_quantity) - qty);
      const nextReserved = Math.max(0, Number(prod.reserved_quantity ?? 0));
      const nextProdStatus =
        nextAvailable === 0 && nextReserved === 0
          ? 'completed'
          : nextAvailable === 0
            ? 'reserved'
            : 'approved';

      const matchRef = doc(collection(db, 'matches'));
      const convId = `conv_${matchRef.id}`;
      const convRef = doc(db, 'conversations', convId);
      const exchangeRef = doc(collection(db, 'exchanges'));
      const ownerConfId = `${exchangeRef.id}_${reqData.owner_id}`;
      const requesterConfId = `${exchangeRef.id}_${reqData.requester_id}`;
      const ownerConfRef = doc(db, 'exchange_confirmations', ownerConfId);
      const requesterConfRef = doc(db, 'exchange_confirmations', requesterConfId);
      const notifRef = doc(collection(db, 'notifications'));
      const productTitle = String(prod.title || 'producto');

      tx.update(reqRef, {
        status: 'accepted',
        updated_at: serverTimestamp(),
      });

      tx.update(productRef, {
        available_quantity: nextAvailable,
        reserved_quantity: nextReserved,
        status: nextProdStatus,
        sync_exchange_id: exchangeRef.id,
        updated_at: serverTimestamp(),
      });

      tx.set(matchRef, {
        id: matchRef.id,
        request_id: requestId,
        target_product_id: reqData.target_product_id,
        offered_product_id: reqData.offered_product_id || null,
        owner_id: reqData.owner_id,
        requester_id: reqData.requester_id,
        modality: reqData.modality,
        quantity_reserved: qty,
        status: 'completed',
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });

      tx.set(convRef, {
        id: convId,
        match_id: matchRef.id,
        participant_a: reqData.owner_id,
        participant_b: reqData.requester_id,
        is_blocked: false,
        blocked_by: null,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });

      tx.set(exchangeRef, {
        id: exchangeRef.id,
        match_id: matchRef.id,
        owner_id: reqData.owner_id,
        requester_id: reqData.requester_id,
        status: 'completed',
        completed_at: serverTimestamp(),
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });

      tx.set(ownerConfRef, {
        id: ownerConfId,
        exchange_id: exchangeRef.id,
        user_id: reqData.owner_id,
        owner_id: reqData.owner_id,
        requester_id: reqData.requester_id,
        confirmed_at: serverTimestamp(),
        notes: 'Entrega confirmada automáticamente al generar Match.',
        measured_weight_kg: null,
      });

      tx.set(requesterConfRef, {
        id: requesterConfId,
        exchange_id: exchangeRef.id,
        user_id: reqData.requester_id,
        owner_id: reqData.owner_id,
        requester_id: reqData.requester_id,
        confirmed_at: serverTimestamp(),
        notes: 'Recepción confirmada automáticamente al generar Match.',
        measured_weight_kg: null,
      });

      tx.set(notifRef, {
        id: notifRef.id,
        user_id: reqData.requester_id,
        event_type: 'match_accepted',
        title: '¡Match Circular y entrega confirmados!',
        body: `Aceptaron tu solicitud por “${productTitle}”. El chat quedó iniciado y la entrega y recepción se confirmaron automáticamente.`.slice(0, 500),
        link_path: `/matches/${matchRef.id}`,
        is_read: false,
        created_at: serverTimestamp(),
      });

      return {
        matchId: matchRef.id,
        conversationId: convId,
        exchangeId: exchangeRef.id,
        ownerId: String(reqData.owner_id),
        requesterId: String(reqData.requester_id),
        isGift: reqData.modality !== 'exchange',
        qtyReserved: qty,
        productData: prod as Record<string, unknown>,
        productId: String(reqData.target_product_id),
        productTitle,
      };
    });

    const initialMessageRef = doc(collection(db, 'messages'));
    await Promise.all([
      setDoc(initialMessageRef, {
        id: initialMessageRef.id,
        conversation_id: txResult.conversationId,
        participant_a: txResult.ownerId,
        participant_b: txResult.requesterId,
        sender_id: currentUid,
        body: `¡Match confirmado por “${txResult.productTitle}”! La entrega y recepción quedaron confirmadas automáticamente. Este chat queda abierto para cualquier detalle.`.slice(
          0,
          1500
        ),
        is_read: false,
        created_at: serverTimestamp(),
      }).catch((msgErr) => {
        console.warn('No se pudo crear el mensaje inicial automático del Match:', msgErr);
      }),
      applyExchangeCompletionSideEffects({
        exchangeId: txResult.exchangeId,
        ownerId: txResult.ownerId,
        requesterId: txResult.requesterId,
        isGift: txResult.isGift,
        qtyReserved: txResult.qtyReserved,
        productData: txResult.productData,
        productId: txResult.productId,
      }),
    ]);

    return txResult.matchId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `match_requests/${requestId}`);
  }
}

export async function updateMatchRequestStatus(
  requestId: string,
  status: 'rejected' | 'cancelled' | 'chat_requested'
): Promise<void> {
  try {
    await updateDoc(doc(db, 'match_requests', requestId), {
      status,
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `match_requests/${requestId}`);
  }
}

async function hydrateMatchDocs(
  matchDocs: { id: string; data: () => Record<string, unknown> }[]
): Promise<MatchRecord[]> {
  if (matchDocs.length === 0) return [];

  const currentUid = auth.currentUser?.uid;
  const productIds: string[] = [];
  const userIds: string[] = [];
  const matchRoleEntries: Array<{
    mid: string;
    ownerId: string;
    requesterId: string;
    roleField: 'owner_id' | 'requester_id' | null;
  }> = [];

  matchDocs.forEach((d) => {
    const data = d.data();
    const ownerId = String(data.owner_id || '');
    const requesterId = String(data.requester_id || '');
    const roleField: 'owner_id' | 'requester_id' | null =
      currentUid && currentUid === ownerId
        ? 'owner_id'
        : currentUid && currentUid === requesterId
          ? 'requester_id'
          : null;
    matchRoleEntries.push({ mid: d.id, ownerId, requesterId, roleField });
    if (data.target_product_id) productIds.push(String(data.target_product_id));
    if (data.offered_product_id) productIds.push(String(data.offered_product_id));
    if (ownerId) userIds.push(ownerId);
    if (requesterId) userIds.push(requesterId);
  });

  const [maps, profiles, images, productSnaps, convLists, exLists] = await Promise.all([
    fetchLookupMaps(),
    fetchProfilesMap(userIds),
    fetchImagesByProductIds(productIds),
    Promise.all(
      Array.from(new Set(productIds)).map((pid) =>
        getDoc(doc(db, 'products', pid)).catch(() => null)
      )
    ),
    Promise.all(
      matchRoleEntries.map(async ({ mid, roleField }) => {
        if (currentUid && roleField) {
          const [asASnap, asBSnap, deterministicSnap] = await Promise.all([
            getDocs(
              query(
                collection(db, 'conversations'),
                where('match_id', '==', mid),
                where('participant_a', '==', currentUid)
              )
            ).catch((err) => {
              console.warn('Error consultando conversations (participant_a):', err);
              return null;
            }),
            getDocs(
              query(
                collection(db, 'conversations'),
                where('match_id', '==', mid),
                where('participant_b', '==', currentUid)
              )
            ).catch((err) => {
              console.warn('Error consultando conversations (participant_b):', err);
              return null;
            }),
            getDoc(doc(db, 'conversations', `conv_${mid}`)).catch(() => null),
          ]);
          const seen = new Map<string, Record<string, unknown>>();
          asASnap?.docs.forEach((cDoc) => seen.set(cDoc.id, cDoc.data()));
          asBSnap?.docs.forEach((cDoc) => seen.set(cDoc.id, cDoc.data()));
          if (deterministicSnap?.exists()) {
            seen.set(deterministicSnap.id, deterministicSnap.data());
          }
          return Array.from(seen.entries()).map(([id, data]) => ({ id, data }));
        }

        const snap = await getDocs(
          query(collection(db, 'conversations'), where('match_id', '==', mid))
        ).catch((err) => {
          console.warn('Error consultando conversations:', err);
          return null;
        });
        return snap ? snap.docs.map((cDoc) => ({ id: cDoc.id, data: cDoc.data() })) : [];
      })
    ),
    Promise.all(
      matchRoleEntries.map(async ({ mid, roleField }) => {
        if (currentUid && roleField) {
          const snap = await getDocs(
            query(
              collection(db, 'exchanges'),
              where('match_id', '==', mid),
              where(roleField, '==', currentUid)
            )
          ).catch((err) => {
            console.warn('Error consultando exchanges:', err);
            return null;
          });
          return {
            roleField,
            docs: snap ? snap.docs.map((eDoc) => ({ id: eDoc.id, data: eDoc.data() })) : [],
          };
        }

        const snap = await getDocs(
          query(collection(db, 'exchanges'), where('match_id', '==', mid))
        ).catch((err) => {
          console.warn('Error consultando exchanges:', err);
          return null;
        });
        return {
          roleField: null as 'owner_id' | 'requester_id' | null,
          docs: snap ? snap.docs.map((eDoc) => ({ id: eDoc.id, data: eDoc.data() })) : [],
        };
      })
    ),
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

  const convByMatch = new Map<string, Conversation[]>();
  convLists.forEach((items) => {
    items.forEach(({ id, data: d }) => {
      const mid = String(d.match_id || '');
      const list = convByMatch.get(mid) ?? [];
      list.push({
        id,
        match_id: mid,
        participant_a: String(d.participant_a || ''),
        participant_b: String(d.participant_b || ''),
        is_blocked: Boolean(d.is_blocked),
        blocked_by: d.blocked_by ? String(d.blocked_by) : null,
        created_at: toIsoString(d.created_at),
      });
      convByMatch.set(mid, list);
    });
  });

  const exchangeEntries: Array<{
    exId: string;
    roleField: 'owner_id' | 'requester_id' | null;
  }> = [];
  const exByMatch = new Map<string, ExchangeRecord[]>();
  exLists.forEach(({ roleField, docs }) => {
    docs.forEach(({ id: exId, data: d }) => {
      const mid = String(d.match_id || '');
      exchangeEntries.push({ exId, roleField });
      const list = exByMatch.get(mid) ?? [];
      list.push({
        id: exId,
        match_id: mid,
        status: d.status,
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
        exchange_confirmations: [],
      });
      exByMatch.set(mid, list);
    });
  });

  const confByEx = new Map<string, ExchangeConfirmation[]>();
  await Promise.all(
    exchangeEntries.map(async ({ exId, roleField }) => {
      const q =
        currentUid && roleField
          ? query(
              collection(db, 'exchange_confirmations'),
              where('exchange_id', '==', exId),
              where(roleField, '==', currentUid)
            )
          : query(collection(db, 'exchange_confirmations'), where('exchange_id', '==', exId));

      const cSnap = await getDocs(q).catch((err) => {
        console.warn('Error consultando exchange_confirmations:', err);
        return null;
      });
      if (!cSnap) return;
      confByEx.set(
        exId,
        cSnap.docs.map((c) => {
          const cd = c.data();
          return {
            id: c.id,
            exchange_id: String(cd.exchange_id || exId),
            user_id: String(cd.user_id || ''),
            confirmed_at: toIsoString(cd.confirmed_at),
            notes: cd.notes ? String(cd.notes) : null,
          };
        })
      );
    })
  );

  exByMatch.forEach((list) => {
    list.forEach((ex) => {
      ex.exchange_confirmations = confByEx.get(ex.id) ?? [];
    });
  });

  return matchDocs
    .map((mDoc) => {
      const d = mDoc.data();
      return {
        id: mDoc.id,
        request_id: String(d.request_id || ''),
        target_product_id: String(d.target_product_id || ''),
        offered_product_id: d.offered_product_id ? String(d.offered_product_id) : null,
        owner_id: String(d.owner_id || ''),
        requester_id: String(d.requester_id || ''),
        modality: d.modality as ProductModality,
        quantity_reserved: Number(d.quantity_reserved ?? 1),
        status: d.status as MatchRecord['status'],
        created_at: toIsoString(d.created_at),
        target_product: productMap.get(String(d.target_product_id || '')) ?? null,
        offered_product: d.offered_product_id
          ? productMap.get(String(d.offered_product_id)) ?? null
          : null,
        owner: profiles.get(String(d.owner_id || '')) ?? null,
        requester: profiles.get(String(d.requester_id || '')) ?? null,
        conversations: convByMatch.get(mDoc.id) ?? [],
        exchanges: exByMatch.get(mDoc.id) ?? [],
      } satisfies MatchRecord;
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function listUserMatches(userId: string): Promise<MatchRecord[]> {
  try {
    const [asOwnerSnap, asRequesterSnap] = await Promise.all([
      getDocs(query(collection(db, 'matches'), where('owner_id', '==', userId))),
      getDocs(query(collection(db, 'matches'), where('requester_id', '==', userId))),
    ]);

    const docMap = new Map<string, (typeof asOwnerSnap.docs)[number]>();
    asOwnerSnap.docs.forEach((d) => docMap.set(d.id, d));
    asRequesterSnap.docs.forEach((d) => docMap.set(d.id, d));
    return hydrateMatchDocs(Array.from(docMap.values()));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'matches');
  }
}

export async function getMatchDetail(matchId: string): Promise<MatchRecord | null> {
  try {
    const snap = await getDoc(doc(db, 'matches', matchId));
    if (!snap.exists()) return null;
    const hydrated = await hydrateMatchDocs([snap]);
    return hydrated[0] ?? null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `matches/${matchId}`);
  }
}
