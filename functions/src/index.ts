import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

initializeApp();

const DATABASE_ID =
  process.env.FIRESTORE_DATABASE_ID ||
  'ai-studio-policircular-5745eafb-1cbd-42f8-b727-1f27410a09e5';

const db = getFirestore(DATABASE_ID);
const adminAuth = getAuth();

type UserRole = 'user' | 'moderator' | 'admin' | 'super_admin';

const BOOTSTRAP_SUPER_ADMINS = new Set(['naourclaudio@gmail.com']);

function computeTreeStage(operations: number): string {
  if (operations >= 15) return 'arbol_frutal';
  if (operations >= 9) return 'arbol_desarrollado';
  if (operations >= 5) return 'arbol_joven';
  if (operations >= 2) return 'brote';
  return 'semilla';
}

async function getCallerRoles(uid: string, email?: string): Promise<UserRole[]> {
  if (email && BOOTSTRAP_SUPER_ADMINS.has(email.toLowerCase())) {
    return ['user', 'moderator', 'admin', 'super_admin'];
  }
  const snap = await db.collection('user_roles').doc(uid).get();
  if (!snap.exists) return ['user'];
  const roles = (snap.data()?.roles as UserRole[] | undefined) || ['user'];
  return roles.length > 0 ? roles : ['user'];
}

function assertVerifiedAuth(auth: { uid: string; token: { email?: string; email_verified?: boolean } } | undefined) {
  if (!auth?.uid) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión para continuar.');
  }
  if (!auth.token.email_verified) {
    throw new HttpsError('permission-denied', 'Debes verificar tu correo electrónico antes de realizar esta acción.');
  }
  return auth;
}

export const assignUserRole = onCall(async (request) => {
  const auth = assertVerifiedAuth(request.auth);
  const callerRoles = await getCallerRoles(auth.uid, auth.token.email);
  if (!callerRoles.includes('super_admin')) {
    throw new HttpsError('permission-denied', 'Solo un Superadministrador puede asignar roles.');
  }

  const { targetUserId, roles } = request.data as { targetUserId?: string; roles?: UserRole[] };
  if (!targetUserId || !Array.isArray(roles) || roles.length === 0) {
    throw new HttpsError('invalid-argument', 'Debe especificar un usuario y al menos un rol válido.');
  }

  const allowed: UserRole[] = ['user', 'moderator', 'admin', 'super_admin'];
  const sanitized = Array.from(new Set(roles.filter((r) => allowed.includes(r))));
  if (!sanitized.includes('user')) sanitized.unshift('user');

  await db.collection('user_roles').doc(targetUserId).set({
    user_id: targetUserId,
    roles: sanitized,
    assigned_by: auth.uid,
    updated_at: FieldValue.serverTimestamp(),
  });

  await db.collection('moderation_logs').add({
    actor_id: auth.uid,
    target_type: 'user_roles',
    target_id: targetUserId,
    action: 'assign_roles',
    new_status: sanitized.join(','),
    notes: `Roles actualizados por Superadministrador`,
    created_at: FieldValue.serverTimestamp(),
  });

  return { ok: true, roles: sanitized };
});

export const moderateProduct = onCall(async (request) => {
  const auth = assertVerifiedAuth(request.auth);
  const callerRoles = await getCallerRoles(auth.uid, auth.token.email);
  if (!callerRoles.some((r) => ['moderator', 'admin', 'super_admin'].includes(r))) {
    throw new HttpsError('permission-denied', 'No tienes permisos de moderación.');
  }

  const { productId, decision, notes } = request.data as {
    productId?: string;
    decision?: 'approved' | 'rejected' | 'suspended';
    notes?: string;
  };
  if (!productId || !decision || !['approved', 'rejected', 'suspended'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'Parámetros de moderación inválidos.');
  }

  const productRef = db.collection('products').doc(productId);
  const productSnap = await productRef.get();
  if (!productSnap.exists) {
    throw new HttpsError('not-found', 'La publicación no existe.');
  }
  const product = productSnap.data()!;

  const batch = db.batch();
  batch.update(productRef, {
    status: decision,
    moderation_notes: notes?.trim() || null,
    moderated_by: auth.uid,
    moderated_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });

  const logRef = db.collection('moderation_logs').doc();
  batch.set(logRef, {
    id: logRef.id,
    actor_id: auth.uid,
    target_type: 'product',
    target_id: productId,
    action: `product_${decision}`,
    previous_status: product.status,
    new_status: decision,
    notes: notes?.trim() || null,
    created_at: FieldValue.serverTimestamp(),
  });

  const notifRef = db.collection('notifications').doc();
  batch.set(notifRef, {
    id: notifRef.id,
    user_id: product.owner_id,
    event_type: `product_${decision}`,
    title:
      decision === 'approved'
        ? '¡Tu publicación fue aprobada!'
        : decision === 'rejected'
          ? 'Tu publicación requiere ajustes'
          : 'Tu publicación fue suspendida',
    body:
      decision === 'approved'
        ? `“${product.title}” ya está visible para la comunidad de PoliCircular.`
        : `“${product.title}” recibió observaciones: ${notes || 'Revisa las reglas comunitarias.'}`,
    link_path: '/mis-publicaciones',
    is_read: false,
    created_at: FieldValue.serverTimestamp(),
  });

  await batch.commit();
  return { ok: true };
});

export const acceptMatchRequest = onCall(async (request) => {
  const auth = assertVerifiedAuth(request.auth);
  const { requestId } = request.data as { requestId?: string };
  if (!requestId) {
    throw new HttpsError('invalid-argument', 'requestId es obligatorio.');
  }

  const reqRef = db.collection('match_requests').doc(requestId);
  const result = await db.runTransaction(async (tx) => {
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists) throw new HttpsError('not-found', 'Solicitud no encontrada.');
    const reqData = reqSnap.data()!;
    if (reqData.owner_id !== auth.uid) {
      throw new HttpsError('permission-denied', 'Solo el oferente puede aceptar esta solicitud.');
    }
    if (!['pending', 'chat_requested'].includes(reqData.status)) {
      throw new HttpsError('failed-precondition', 'La solicitud ya fue procesada.');
    }

    const productRef = db.collection('products').doc(reqData.target_product_id);
    const productSnap = await tx.get(productRef);
    if (!productSnap.exists) throw new HttpsError('not-found', 'Producto no encontrado.');
    const product = productSnap.data()!;
    if (product.status !== 'approved' || product.available_quantity < reqData.requested_quantity) {
      throw new HttpsError('failed-precondition', 'Stock disponible insuficiente para reservar.');
    }

    const nextAvailable = product.available_quantity - reqData.requested_quantity;
    const nextReserved = product.reserved_quantity + reqData.requested_quantity;

    tx.update(reqRef, { status: 'accepted', updated_at: FieldValue.serverTimestamp() });
    tx.update(productRef, {
      available_quantity: nextAvailable,
      reserved_quantity: nextReserved,
      status: nextAvailable === 0 ? 'reserved' : 'approved',
      updated_at: FieldValue.serverTimestamp(),
    });

    const matchRef = db.collection('matches').doc();
    tx.set(matchRef, {
      id: matchRef.id,
      request_id: requestId,
      target_product_id: reqData.target_product_id,
      offered_product_id: reqData.offered_product_id || null,
      owner_id: reqData.owner_id,
      requester_id: reqData.requester_id,
      modality: reqData.modality,
      quantity_reserved: reqData.requested_quantity,
      status: 'active',
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });

    const convRef = db.collection('conversations').doc();
    tx.set(convRef, {
      id: convRef.id,
      match_id: matchRef.id,
      participant_a: reqData.owner_id,
      participant_b: reqData.requester_id,
      is_blocked: false,
      blocked_by: null,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });

    const exchangeRef = db.collection('exchanges').doc();
    tx.set(exchangeRef, {
      id: exchangeRef.id,
      match_id: matchRef.id,
      owner_id: reqData.owner_id,
      requester_id: reqData.requester_id,
      status: 'pending',
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });

    const notifRef = db.collection('notifications').doc();
    tx.set(notifRef, {
      id: notifRef.id,
      user_id: reqData.requester_id,
      event_type: 'match_accepted',
      title: '¡Tienes un nuevo Match Circular!',
      body: `Aceptaron tu solicitud por “${product.title}”. Ya puedes coordinar la entrega en el chat.`,
      link_path: `/matches/${matchRef.id}`,
      is_read: false,
      created_at: FieldValue.serverTimestamp(),
    });

    return matchRef.id;
  });

  return { matchId: result };
});

export const confirmExchangeDelivery = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const auth = request.auth;
  const { exchangeId, notes, measuredWeightKg } = request.data as {
    exchangeId?: string;
    notes?: string;
    measuredWeightKg?: number;
  };
  if (!exchangeId) {
    throw new HttpsError('invalid-argument', 'exchangeId es obligatorio.');
  }

  const exchangeRef = db.collection('exchanges').doc(exchangeId);
  const res = await db.runTransaction(async (tx) => {
    const exSnap = await tx.get(exchangeRef);
    if (!exSnap.exists) throw new HttpsError('not-found', 'Intercambio no encontrado.');
    const ex = exSnap.data()!;

    if (ex.owner_id !== auth.uid && ex.requester_id !== auth.uid) {
      throw new HttpsError('permission-denied', 'No eres participante de este intercambio.');
    }
    if (['completed', 'cancelled'].includes(ex.status)) {
      return { completed: ex.status === 'completed' };
    }

    const myConfRef = db.collection('exchange_confirmations').doc(`${exchangeId}_${auth.uid}`);
    const myConfSnap = await tx.get(myConfRef);
    const otherUid = ex.owner_id === auth.uid ? ex.requester_id : ex.owner_id;

    const matchSnap = ex.match_id ? await tx.get(db.collection('matches').doc(ex.match_id)) : null;
    const match = matchSnap?.exists ? matchSnap.data()! : null;
    const productRef = match?.target_product_id
      ? db.collection('products').doc(match.target_product_id)
      : null;
    const productSnap = productRef ? await tx.get(productRef) : null;
    const product = productSnap?.exists ? productSnap.data()! : null;
    const categorySnap =
      product?.category_id ? await tx.get(db.collection('categories').doc(product.category_id)) : null;
    const categoryWeight = categorySnap?.data()?.estimated_weight_kg || 1;

    const ownerTreeRef = db.collection('user_tree_progress').doc(ex.owner_id);
    const requesterTreeRef = db.collection('user_tree_progress').doc(ex.requester_id);
    const impactRef = db.collection('impact_records').doc(exchangeId);
    const [ownerTreeSnap, requesterTreeSnap, impactSnap, achievementsSnap] = await Promise.all([
      tx.get(ownerTreeRef),
      tx.get(requesterTreeRef),
      tx.get(impactRef),
      tx.get(db.collection('achievements')),
    ]);

    if (!myConfSnap.exists) {
      tx.set(myConfRef, {
        id: myConfRef.id,
        exchange_id: exchangeId,
        user_id: auth.uid,
        owner_id: ex.owner_id,
        requester_id: ex.requester_id,
        confirmed_at: FieldValue.serverTimestamp(),
        notes: notes?.trim() || null,
        measured_weight_kg: typeof measuredWeightKg === 'number' ? measuredWeightKg : null,
      });
    }

    tx.update(exchangeRef, {
      status: 'completed',
      completed_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });

    if (matchSnap?.exists && match?.status === 'active') {
      tx.update(db.collection('matches').doc(ex.match_id), {
        status: 'completed',
        updated_at: FieldValue.serverTimestamp(),
      });
    }

    const qtyReserved = Math.max(1, Number(match?.quantity_reserved || 1));
    if (productRef && product && product.status !== 'completed') {
      const newReserved = Math.max(0, (product.reserved_quantity || 0) - qtyReserved);
      const nextProductStatus =
        (product.available_quantity || 0) === 0 && newReserved === 0
          ? 'completed'
          : newReserved > 0
            ? 'reserved'
            : 'approved';
      tx.update(productRef, {
        reserved_quantity: newReserved,
        status: nextProductStatus,
        sync_exchange_id: exchangeId,
        updated_at: FieldValue.serverTimestamp(),
      });
    }

    const isGift = match ? match.modality === 'gift' : true;
    for (const [uid, snap] of [
      [ex.owner_id, ownerTreeSnap],
      [ex.requester_id, requesterTreeSnap],
    ] as const) {
      const prev = snap.exists
        ? snap.data()!
        : { completed_operations: 0, completed_gifts: 0, completed_exchanges: 0, last_exchange_id: null };
      if (prev.last_exchange_id !== exchangeId) {
        const nextOps = (prev.completed_operations || 0) + 1;
        const nextGifts = (prev.completed_gifts || 0) + (isGift ? 1 : 0);
        const nextEx = (prev.completed_exchanges || 0) + (isGift ? 0 : 1);
        tx.set(db.collection('user_tree_progress').doc(uid), {
          user_id: uid,
          completed_operations: nextOps,
          completed_gifts: nextGifts,
          completed_exchanges: nextEx,
          current_stage: computeTreeStage(nextOps),
          last_exchange_id: exchangeId,
          updated_at: FieldValue.serverTimestamp(),
        });

        achievementsSnap.docs.forEach((achDoc) => {
          const ach = achDoc.data();
          if (nextOps >= ach.required_operations) {
            const uaRef = db.collection('user_achievements').doc(`${uid}_${ach.id}`);
            tx.set(uaRef, {
              id: uaRef.id,
              user_id: uid,
              achievement_id: ach.id,
              exchange_id: exchangeId,
              unlocked_at: FieldValue.serverTimestamp(),
            });
          }
        });
      }
    }

    if (!impactSnap.exists && product) {
      const totalWeight =
        typeof measuredWeightKg === 'number' && measuredWeightKg > 0
          ? measuredWeightKg
          : Number((categoryWeight * qtyReserved).toFixed(2));
      tx.set(impactRef, {
        id: exchangeId,
        exchange_id: exchangeId,
        product_id: product.id,
        category_id: product.category_id || 'otros',
        commune_id: product.commune_id || 'castro',
        sector_id: product.sector_id || null,
        modality: match?.modality || 'gift',
        quantity: qtyReserved,
        weight_kg: totalWeight,
        weight_type: typeof measuredWeightKg === 'number' && measuredWeightKg > 0 ? 'measured' : 'estimated',
        created_at: FieldValue.serverTimestamp(),
      });
    }

    if (otherUid && otherUid !== auth.uid) {
      const notifRef = db.collection('notifications').doc();
      tx.set(notifRef, {
        id: notifRef.id,
        user_id: otherUid,
        event_type: 'exchange_completed',
        title: '¡Entrega circular completada!',
        body: 'La entrega fue confirmada. Tu Árbol Circular creció y ya puedes dejar una reseña.',
        link_path: '/mi-arbol',
        is_read: false,
        created_at: FieldValue.serverTimestamp(),
      });
    }

    return { completed: true };
  });

  return res;
});

export const cancelExchangeAgreement = onCall(async (request) => {
  const auth = assertVerifiedAuth(request.auth);
  const { exchangeId, reason } = request.data as { exchangeId?: string; reason?: string };
  if (!exchangeId) throw new HttpsError('invalid-argument', 'exchangeId es obligatorio.');

  await db.runTransaction(async (tx) => {
    const exRef = db.collection('exchanges').doc(exchangeId);
    const exSnap = await tx.get(exRef);
    if (!exSnap.exists) throw new HttpsError('not-found', 'Intercambio no encontrado.');
    const ex = exSnap.data()!;
    if (ex.owner_id !== auth.uid && ex.requester_id !== auth.uid) {
      throw new HttpsError('permission-denied', 'Sin permiso para cancelar este intercambio.');
    }
    if (['completed', 'cancelled'].includes(ex.status)) {
      throw new HttpsError('failed-precondition', 'No se puede cancelar este estado.');
    }

    const matchRef = db.collection('matches').doc(ex.match_id);
    const matchSnap = await tx.get(matchRef);
    const match = matchSnap.data()!;
    const productRef = db.collection('products').doc(match.target_product_id);
    const productSnap = await tx.get(productRef);
    const product = productSnap.data()!;

    tx.update(exRef, {
      status: 'cancelled',
      cancelled_by: auth.uid,
      cancellation_reason: reason?.trim() || 'Cancelado por participante',
      updated_at: FieldValue.serverTimestamp(),
    });
    tx.update(matchRef, { status: 'cancelled', updated_at: FieldValue.serverTimestamp() });
    tx.update(productRef, {
      available_quantity: product.available_quantity + match.quantity_reserved,
      reserved_quantity: Math.max(0, product.reserved_quantity - match.quantity_reserved),
      status: 'approved',
      sync_exchange_id: exchangeId,
      updated_at: FieldValue.serverTimestamp(),
    });
  });

  return { ok: true };
});

export const deleteOwnAccount = onCall(async (request) => {
  const auth = request.auth;
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sesión requerida.');

  await db.collection('users').doc(auth.uid).update({
    is_suspended: true,
    suspension_reason: 'Cuenta eliminada por el usuario',
    updated_at: FieldValue.serverTimestamp(),
  });
  await db.collection('users').doc(auth.uid).collection('private').doc('contact').delete();
  await adminAuth.deleteUser(auth.uid);

  return { ok: true };
});
