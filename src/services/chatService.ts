import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  toIsoString,
  toNullableIsoString,
} from './firebase';
import type { Conversation, MatchRecord, Message } from '../types/domain';

export type ParticipantField = 'participant_a' | 'participant_b';

function mapMessage(id: string, d: Record<string, unknown>): Message {
  return {
    id,
    conversation_id: String(d.conversation_id || ''),
    sender_id: String(d.sender_id || ''),
    body: String(d.body || ''),
    is_read: Boolean(d.is_read),
    read_at: toNullableIsoString(d.read_at),
    created_at: toIsoString(d.created_at),
  };
}

function mapConversation(id: string, d: Record<string, unknown>, fallbackMatchId = ''): Conversation {
  return {
    id,
    match_id: String(d.match_id || fallbackMatchId),
    participant_a: String(d.participant_a || ''),
    participant_b: String(d.participant_b || ''),
    is_blocked: Boolean(d.is_blocked),
    blocked_by: d.blocked_by ? String(d.blocked_by) : null,
    created_at: toIsoString(d.created_at),
  };
}

export function resolveParticipantField(
  conv: Pick<Conversation, 'participant_a' | 'participant_b'> | null | undefined,
  uid?: string | null
): ParticipantField | undefined {
  if (!conv || !uid) return undefined;
  if (conv.participant_a === uid) return 'participant_a';
  if (conv.participant_b === uid) return 'participant_b';
  return undefined;
}

export async function getConversationByMatch(
  matchId: string,
  userId?: string
): Promise<Conversation | null> {
  const uid = userId || auth.currentUser?.uid;
  try {
    if (uid) {
      const [asASnap, asBSnap, deterministicSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, 'conversations'),
            where('match_id', '==', matchId),
            where('participant_a', '==', uid)
          )
        ).catch(() => null),
        getDocs(
          query(
            collection(db, 'conversations'),
            where('match_id', '==', matchId),
            where('participant_b', '==', uid)
          )
        ).catch(() => null),
        getDoc(doc(db, 'conversations', `conv_${matchId}`)).catch(() => null),
      ]);

      const foundDoc = asASnap?.docs[0] || asBSnap?.docs[0];
      if (foundDoc) {
        return mapConversation(foundDoc.id, foundDoc.data(), matchId);
      }
      if (deterministicSnap?.exists()) {
        return mapConversation(deterministicSnap.id, deterministicSnap.data(), matchId);
      }
    }

    const snap = await getDocs(
      query(collection(db, 'conversations'), where('match_id', '==', matchId))
    );
    if (snap.empty) return null;
    const cDoc = snap.docs[0];
    return mapConversation(cDoc.id, cDoc.data(), matchId);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'conversations');
  }
}

export async function ensureMatchConversation(
  match: Pick<MatchRecord, 'id' | 'owner_id' | 'requester_id'>,
  currentUid?: string
): Promise<Conversation | null> {
  const uid = currentUid || auth.currentUser?.uid;
  if (!uid) return null;

  const existing = await getConversationByMatch(match.id, uid).catch(() => null);
  if (existing) return existing;

  if (uid !== match.owner_id && uid !== match.requester_id) {
    return null;
  }

  const convId = `conv_${match.id}`;
  const convRef = doc(db, 'conversations', convId);

  try {
    const convSnap = await getDoc(convRef).catch(() => null);
    if (convSnap?.exists()) {
      return mapConversation(convSnap.id, convSnap.data(), match.id);
    }

    await setDoc(convRef, {
      id: convId,
      match_id: match.id,
      participant_a: match.owner_id,
      participant_b: match.requester_id,
      is_blocked: false,
      blocked_by: null,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });

    return {
      id: convId,
      match_id: match.id,
      participant_a: match.owner_id,
      participant_b: match.requester_id,
      is_blocked: false,
      blocked_by: null,
      created_at: new Date().toISOString(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `conversations/${convId}`);
  }
}

async function fetchMessageDocsScoped(
  conversationId: string,
  userId?: string,
  participantField?: ParticipantField
): Promise<QueryDocumentSnapshot[]> {
  const uid = userId || auth.currentUser?.uid;
  if (uid && participantField) {
    const snap = await getDocs(
      query(
        collection(db, 'messages'),
        where('conversation_id', '==', conversationId),
        where(participantField, '==', uid)
      )
    );
    return snap.docs;
  }

  if (uid) {
    const [asASnap, asBSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, 'messages'),
          where('conversation_id', '==', conversationId),
          where('participant_a', '==', uid)
        )
      ),
      getDocs(
        query(
          collection(db, 'messages'),
          where('conversation_id', '==', conversationId),
          where('participant_b', '==', uid)
        )
      ),
    ]);
    const docMap = new Map<string, QueryDocumentSnapshot>();
    asASnap.docs.forEach((d) => docMap.set(d.id, d));
    asBSnap.docs.forEach((d) => docMap.set(d.id, d));
    if (docMap.size > 0) {
      return Array.from(docMap.values());
    }
    return [];
  }

  const snap = await getDocs(
    query(collection(db, 'messages'), where('conversation_id', '==', conversationId))
  );
  return snap.docs;
}

export async function listMessages(
  conversationId: string,
  opts?: { userId?: string; participantField?: ParticipantField }
): Promise<Message[]> {
  try {
    const docs = await fetchMessageDocsScoped(
      conversationId,
      opts?.userId,
      opts?.participantField
    );
    return docs
      .map((d) => mapMessage(d.id, d.data()))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'messages');
  }
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  body: string
): Promise<Message> {
  const cleanBody = body.trim().slice(0, 1500);
  if (!cleanBody) {
    throw new Error('Escribe un mensaje antes de enviar.');
  }

  const convSnap = await getDoc(doc(db, 'conversations', conversationId));
  if (!convSnap.exists()) {
    throw new Error('No se encontró la conversación del match.');
  }
  const conv = convSnap.data();
  if (conv.is_blocked) {
    throw new Error('Esta conversación está bloqueada.');
  }

  const msgRef = doc(collection(db, 'messages'));

  try {
    await setDoc(msgRef, {
      id: msgRef.id,
      conversation_id: conversationId,
      participant_a: String(conv.participant_a),
      participant_b: String(conv.participant_b),
      sender_id: senderId,
      body: cleanBody,
      is_read: false,
      created_at: serverTimestamp(),
    });

    return {
      id: msgRef.id,
      conversation_id: conversationId,
      sender_id: senderId,
      body: cleanBody,
      is_read: false,
      read_at: null,
      created_at: new Date().toISOString(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `messages/${msgRef.id}`);
  }
}

export async function markConversationMessagesRead(
  conversationId: string,
  currentUserId: string,
  participantField?: ParticipantField
): Promise<void> {
  try {
    const docs = await fetchMessageDocsScoped(conversationId, currentUserId, participantField);
    const unreadFromOther = docs.filter(
      (d) => !d.data().is_read && d.data().sender_id !== currentUserId
    );
    if (unreadFromOther.length === 0) return;

    const batch = writeBatch(db);
    unreadFromOther.forEach((d) => {
      batch.update(d.ref, {
        is_read: true,
        read_at: serverTimestamp(),
      });
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'messages');
  }
}

export async function toggleConversationBlock(
  conversationId: string,
  userId: string,
  block: boolean
): Promise<void> {
  try {
    await updateDoc(doc(db, 'conversations', conversationId), {
      is_blocked: block,
      blocked_by: block ? userId : null,
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `conversations/${conversationId}`);
  }
}

export function subscribeToConversationMessages(
  conversationId: string,
  onInsert: (msg: Message) => void,
  onUpdate: (msg: Message) => void,
  opts?: {
    userId?: string;
    participantField?: ParticipantField;
    onError?: (err: unknown) => void;
  }
): { unsubscribe: () => void } {
  const uid = opts?.userId || auth.currentUser?.uid;
  const queries =
    uid && opts?.participantField
      ? [
          query(
            collection(db, 'messages'),
            where('conversation_id', '==', conversationId),
            where(opts.participantField, '==', uid)
          ),
        ]
      : uid
        ? [
            query(
              collection(db, 'messages'),
              where('conversation_id', '==', conversationId),
              where('participant_a', '==', uid)
            ),
            query(
              collection(db, 'messages'),
              where('conversation_id', '==', conversationId),
              where('participant_b', '==', uid)
            ),
          ]
        : [query(collection(db, 'messages'), where('conversation_id', '==', conversationId))];

  const unsubs = queries.map((q) =>
    onSnapshot(
      q,
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          const msg = mapMessage(change.doc.id, change.doc.data());
          if (change.type === 'added') onInsert(msg);
          if (change.type === 'modified') onUpdate(msg);
        });
      },
      (error) => {
        console.error('Error en suscripción de chat Firestore:', error);
        opts?.onError?.(error);
      }
    )
  );

  return {
    unsubscribe: () => {
      unsubs.forEach((u) => u());
    },
  };
}
