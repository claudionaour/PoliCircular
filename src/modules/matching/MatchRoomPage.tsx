import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Ban,
  CheckCheck,
  CheckCircle2,
  Flag,
  Send,
  ShieldAlert,
  Star,
  Truck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getMatchDetail } from '../../services/matchingService';
import {
  ensureMatchConversation,
  listMessages,
  markConversationMessagesRead,
  resolveParticipantField,
  sendMessage,
  subscribeToConversationMessages,
  toggleConversationBlock,
} from '../../services/chatService';
import {
  cancelExchangeAgreementRpc,
  confirmExchangeDeliveryRpc,
  listMySubmittedReviewExchangeIds,
} from '../../services/exchangeService';
import { translateFirebaseError } from '../../services/firebase';
import { ReportModal } from '../../components/ReportModal';
import { ReviewFormModal } from '../reviews/ReviewFormModal';
import { formatChileDateTime } from '../../utils/formatters';
import type { Conversation, MatchRecord, Message } from '../../types/domain';

export const MatchRoomPage: React.FC = () => {
  const { matchId } = useParams<{ matchId: string }>();
  const { user } = useAuth();

  const [match, setMatch] = useState<MatchRecord | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [alreadyReviewed, setAlreadyReviewed] = useState(false);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadData = useCallback(async () => {
    if (!matchId || !user) return;
    setLoading(true);
    setError(null);
    try {
      const [m, revIds] = await Promise.all([
        getMatchDetail(matchId),
        listMySubmittedReviewExchangeIds(user.uid).catch(() => [] as string[]),
      ]);
      setMatch(m);
      const exId = m?.exchanges?.[0]?.id;
      setAlreadyReviewed(Boolean(exId && revIds.includes(exId)));

      let conv = m?.conversations?.[0] ?? null;
      if (!conv && m) {
        conv = await ensureMatchConversation(m, user.uid);
      }
      setConversation(conv);
      if (conv) {
        const participantField = resolveParticipantField(conv, user.uid);
        const msgs = await listMessages(conv.id, { userId: user.uid, participantField });
        setMessages(msgs);
        await markConversationMessagesRead(conv.id, user.uid, participantField).catch(() => {});
      }
    } catch (err) {
      setError(translateFirebaseError(err));
    } finally {
      setLoading(false);
    }
  }, [matchId, user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!conversation || !user) return;
    const participantField = resolveParticipantField(conversation, user.uid);
    const channel = subscribeToConversationMessages(
      conversation.id,
      (incoming) => {
        // Handler idempotente ordenado cronológicamente
        setMessages((prev) => {
          if (prev.some((m) => m.id === incoming.id)) return prev;
          return [...prev, incoming].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        });
        if (incoming.sender_id !== user.uid) {
          markConversationMessagesRead(conversation.id, user.uid, participantField).catch(() => {});
        }
      },
      (updated) => {
        setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      },
      {
        userId: user.uid,
        participantField,
        onError: (subErr) => {
          setError(translateFirebaseError(subErr));
        },
      }
    );

    return () => {
      channel.unsubscribe();
    };
  }, [conversation, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!conversation || !user || !draft.trim() || conversation.is_blocked) return;
    setSending(true);
    setError(null);
    try {
      const sent = await sendMessage(conversation.id, user.uid, draft);
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
      setDraft('');
    } catch (err) {
      setError(translateFirebaseError(err));
    } finally {
      setSending(false);
    }
  };

  const handleBlockToggle = async () => {
    if (!conversation || !user || actionBusy) return;
    setError(null);
    setActionBusy(true);
    const nextBlock = !conversation.is_blocked;
    try {
      await toggleConversationBlock(conversation.id, user.uid, nextBlock);
      setConversation({
        ...conversation,
        is_blocked: nextBlock,
        blocked_by: nextBlock ? user.uid : null,
      });
    } catch (err) {
      setError(translateFirebaseError(err));
    } finally {
      setActionBusy(false);
    }
  };

  const handleConfirmLegacyExchange = async () => {
    const exchange = match?.exchanges?.[0];
    if (!exchange || actionBusy) return;
    setError(null);
    setActionBusy(true);
    try {
      await confirmExchangeDeliveryRpc({ exchangeId: exchange.id });
      await loadData();
    } catch (err) {
      setError(translateFirebaseError(err));
    } finally {
      setActionBusy(false);
    }
  };

  const handleCancelAgreement = async () => {
    const exchange = match?.exchanges?.[0];
    if (!exchange || actionBusy) return;
    setError(null);
    setActionBusy(true);
    try {
      await cancelExchangeAgreementRpc(exchange.id, 'Cancelado desde el chat del Match');
      await loadData();
    } catch (err) {
      setError(translateFirebaseError(err));
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-slate-200">Cargando chat privado...</div>;
  }

  if (!match || !conversation) {
    return (
      <div className="rounded-2xl bg-[#102C49] border border-[#244B73] p-8 text-center space-y-3">
        <p className="font-display font-bold text-white">Conversación no encontrada o no autorizada</p>
        {error && (
          <p className="text-xs text-red-200 bg-red-950/70 border border-red-400/40 rounded-xl p-3 max-w-md mx-auto">
            {error}
          </p>
        )}
        <Link to="/matches" className="mt-3 inline-block text-sm font-semibold text-[#FFA94D]">
          Volver a Mis Match
        </Link>
      </div>
    );
  }

  const other = match.owner_id === user?.uid ? match.requester : match.owner;
  const exchange = match.exchanges?.[0];
  const involvesMinor = Boolean(match.owner?.is_minor_supervised || match.requester?.is_minor_supervised);
  const isCompleted = exchange?.status === 'completed';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/matches"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-200 hover:text-[#FFA94D]"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Mis Match</span>
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/intercambios"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#3B648F] bg-[#102C49] text-xs font-semibold text-white hover:bg-[#163B61]"
          >
            <Truck className="h-3.5 w-3.5 text-[#FFA94D]" />
            <span>Mis intercambios</span>
          </Link>
          <button
            type="button"
            disabled={actionBusy}
            onClick={handleBlockToggle}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-[#3B648F] bg-[#102C49] text-xs font-semibold text-white hover:bg-[#163B61] disabled:opacity-50"
          >
            <Ban className="h-3.5 w-3.5" />
            <span>{conversation.is_blocked ? 'Desbloquear' : 'Bloquear'}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowReport(true)}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-[#3B648F] bg-[#102C49] text-xs font-semibold text-white hover:text-red-300"
          >
            <Flag className="h-3.5 w-3.5" />
            <span>Denunciar</span>
          </button>
          {exchange && exchange.status !== 'completed' && exchange.status !== 'cancelled' && (
            <button
              type="button"
              disabled={actionBusy}
              onClick={handleCancelAgreement}
              className="px-3 py-2 rounded-xl border border-red-400/40 bg-red-950/70 text-xs font-semibold text-red-200 disabled:opacity-50"
            >
              Cancelar acuerdo
            </button>
          )}
        </div>
      </div>

      {/* Estado automático de entrega y recepción */}
      {exchange && (
        <div
          className={`rounded-xl border px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs ${
            isCompleted
              ? 'bg-[#143D29] border-[#34D399]/40 text-[#A7F3D0]'
              : 'bg-[#102C49] border-[#244B73] text-slate-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-[#6EE7B7] shrink-0" />
            <span>
              {isCompleted
                ? 'Match confirmado · Entrega y recepción confirmadas automáticamente. Tu Árbol Circular ya registró esta operación.'
                : 'Este intercambio aún figura pendiente de confirmación.'}
            </span>
          </div>

          {isCompleted ? (
            alreadyReviewed ? (
              <span className="font-semibold text-[#6EE7B7]">Evaluación enviada</span>
            ) : (
              <button
                type="button"
                onClick={() => setShowReviewModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#F28C28] text-[#0B1E33] font-bold hover:bg-[#FFA242]"
              >
                <Star className="h-3.5 w-3.5" />
                <span>Evaluar experiencia</span>
              </button>
            )
          ) : exchange.status !== 'cancelled' ? (
            <button
              type="button"
              disabled={actionBusy}
              onClick={handleConfirmLegacyExchange}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#1E7E48] text-white font-semibold hover:bg-[#239454] disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{actionBusy ? 'Confirmando...' : 'Confirmar entrega y recepción'}</span>
            </button>
          ) : null}
        </div>
      )}

      {involvesMinor && (
        <div className="rounded-xl bg-[#2A2015] border border-[#F28C28]/40 p-3 text-xs text-[#FDE68A] flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-[#FFA94D] shrink-0" />
          <span>
            Participa una cuenta escolar o supervisada. Acuerda entregas únicamente en establecimientos educacionales o puntos públicos comunitarios junto a un adulto responsable.
          </span>
        </div>
      )}

      <div className="rounded-2xl bg-[#102C49] border border-[#244B73] overflow-hidden flex flex-col h-[60vh] min-h-[400px]">
        <div className="px-5 py-3.5 border-b border-[#244B73] bg-[#081626] flex items-center justify-between">
          <div>
            <h1 className="font-display font-bold text-base text-white">
              Chat privado con {other?.full_name}
            </h1>
            <p className="text-xs text-slate-300">
              Producto: {match.target_product?.title} ({match.quantity_reserved} u.)
            </p>
          </div>
          <span className="text-xs font-semibold text-[#6EE7B7]">Tiempo real</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#0B1E33]">
          {messages.length === 0 ? (
            <p className="text-center text-xs text-slate-300 my-8">
              ¡Match listo! Escribe aquí si quieres saludar o acordar algún detalle con tu contraparte.
            </p>
          ) : (
            messages.map((msg) => {
              const isMine = msg.sender_id === user?.uid;
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                      isMine
                        ? 'bg-[#F28C28] text-[#0B1E33] font-medium'
                        : 'bg-[#102C49] text-white border border-[#244B73]'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-300">
                    <span>{formatChileDateTime(msg.created_at)}</span>
                    {isMine && (
                      <CheckCheck
                        className={`h-3.5 w-3.5 ${msg.is_read ? 'text-[#FFA94D]' : 'text-slate-400'}`}
                      />
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {error && (
          <div className="px-4 py-2 bg-red-950/70 border-t border-red-400/40 text-xs text-red-200">
            {error}
          </div>
        )}

        <form
          onSubmit={handleSend}
          className="p-3 border-t border-[#244B73] bg-[#081626] flex items-center gap-2"
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={1500}
            disabled={conversation.is_blocked || sending}
            placeholder={
              conversation.is_blocked
                ? 'Esta conversación está bloqueada.'
                : 'Escribe un mensaje...'
            }
            className="flex-1 rounded-xl border border-[#2D557F] bg-[#102C49] text-white placeholder:text-slate-400 px-3.5 py-2.5 text-sm focus:border-[#FFA94D] focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={conversation.is_blocked || sending || !draft.trim()}
            className="px-4 py-2.5 rounded-xl bg-[#F28C28] text-[#0B1E33] text-sm font-bold hover:bg-[#FFA242] disabled:opacity-50 inline-flex items-center gap-1.5 min-h-[44px]"
          >
            <Send className="h-4 w-4" />
            <span className="hidden sm:inline">Enviar</span>
          </button>
        </form>
      </div>

      {showReviewModal && exchange && (
        <ReviewFormModal
          exchangeId={exchange.id}
          targetName={other?.full_name || 'Participante'}
          onClose={() => setShowReviewModal(false)}
          onSuccess={() => {
            setShowReviewModal(false);
            setAlreadyReviewed(true);
            loadData();
          }}
        />
      )}

      {showReport && (
        <ReportModal
          targetType="conversation"
          targetId={conversation.id}
          targetTitle={`Conversación con ${other?.full_name}`}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
};
