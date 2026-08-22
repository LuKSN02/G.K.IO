// ============================================================
// G.K.IO — Inicialização do Firebase + helpers de acesso a dados
// ============================================================
import { firebaseConfig } from './firebase-config.js';

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, updateProfile as fbUpdateProfile,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, setDoc, addDoc, updateDoc, deleteDoc,
  getDoc, getDocs, query, where, orderBy, limit, onSnapshot,
  serverTimestamp, arrayUnion, arrayRemove, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
// Observação: o upload de mídia (avatar, banner, anexos) usa o Cloudinary
// (ver js/cloudinary.js), não o Firebase Storage — o Storage exige o plano
// pago (Blaze) do Firebase mesmo dentro da cota gratuita, então o G.K.IO
// evita essa dependência.

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export {
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, fbUpdateProfile,
  collection, doc, setDoc, addDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, arrayUnion, arrayRemove, writeBatch,
};

// ---------- Referências de coleção (schema do G.K.IO) ----------
// users/{uid}                          -> perfil público do usuário
// users/{uid}/socialLinks/{linkId}      -> links de redes sociais
// friendships/{friendshipId}            -> { userIds: [a,b], requesterId, status }
// directMessages/{dmId}                 -> { participantIds: [...], isGroup, lastMessageAt }
// directMessages/{dmId}/messages/{id}   -> mensagens de DM
// servers/{serverId}                    -> { name, iconUrl, ownerId, memberIds }
// servers/{serverId}/categories/{id}    -> { name, position }
// servers/{serverId}/channels/{id}      -> { name, type, categoryId, position }
// servers/{serverId}/channels/{id}/messages/{id} -> mensagens de canal
// servers/{serverId}/members/{uid}      -> { nickname, joinedAt }
// invites/{code}                        -> { serverId, createdBy, expiresAt, maxUses, uses }
// calls/{callId}                        -> sinalização WebRTC (offer/answer/candidates)

export const usersCol = () => collection(db, 'users');
export const userDoc = (uid) => doc(db, 'users', uid);
export const socialLinksCol = (uid) => collection(db, 'users', uid, 'socialLinks');

export const serversCol = () => collection(db, 'servers');
export const serverDoc = (serverId) => doc(db, 'servers', serverId);
export const categoriesCol = (serverId) => collection(db, 'servers', serverId, 'categories');
export const channelsCol = (serverId) => collection(db, 'servers', serverId, 'channels');
export const channelDoc = (serverId, channelId) => doc(db, 'servers', serverId, 'channels', channelId);
export const channelMessagesCol = (serverId, channelId) =>
  collection(db, 'servers', serverId, 'channels', channelId, 'messages');
export const channelMessageDoc = (serverId, channelId, msgId) =>
  doc(db, 'servers', serverId, 'channels', channelId, 'messages', msgId);
export const membersCol = (serverId) => collection(db, 'servers', serverId, 'members');
export const memberDoc = (serverId, uid) => doc(db, 'servers', serverId, 'members', uid);
// Cargos personalizados (roles): nome, cor e um conjunto de permissões
// granulares. Ficam guardados em servers/{serverId}/roles/{roleId} e são
// atribuídos a membros via members/{uid}.roleIds (array de ids de cargo).
export const rolesCol = (serverId) => collection(db, 'servers', serverId, 'roles');
export const roleDoc = (serverId, roleId) => doc(db, 'servers', serverId, 'roles', roleId);

export const invitesCol = () => collection(db, 'invites');
export const inviteDoc = (code) => doc(db, 'invites', code);

export const friendshipsCol = () => collection(db, 'friendships');

export const dmsCol = () => collection(db, 'directMessages');
export const dmDoc = (dmId) => doc(db, 'directMessages', dmId);
export const dmMessagesCol = (dmId) => collection(db, 'directMessages', dmId, 'messages');
export const dmMessageDoc = (dmId, msgId) => doc(db, 'directMessages', dmId, 'messages', msgId);

export const callsCol = () => collection(db, 'calls');
export const callDoc = (callId) => doc(db, 'calls', callId);
export const voicePresenceCol = (serverId, channelId) =>
  collection(db, 'servers', serverId, 'channels', channelId, 'voicePresence');

// emojis personalizados — biblioteca compartilhada, disponível em
// qualquer conversa (servidores e DMs), como um "pacote" único do app.
export const customEmojisCol = () => collection(db, 'customEmojis');
export const customEmojiDoc = (emojiId) => doc(db, 'customEmojis', emojiId);

// "Digitando..." — doc efêmero por pessoa, dentro do canal/DM em que ela
// está digitando agora (ver js/typing.js). id do doc = uid de quem digita,
// assim cada pessoa só pode escrever no próprio.
export const typingCol = (serverId, channelId) =>
  collection(db, 'servers', serverId, 'channels', channelId, 'typing');
export const typingDoc = (serverId, channelId, uid) =>
  doc(db, 'servers', serverId, 'channels', channelId, 'typing', uid);
export const dmTypingCol = (dmId) => collection(db, 'directMessages', dmId, 'typing');
export const dmTypingDoc = (dmId, uid) => doc(db, 'directMessages', dmId, 'typing', uid);

// Estado de leitura — um doc por (usuário, conversa), guardando quando foi
// a última vez que a pessoa "olhou" pra ela. id previsível (uid_conversationId)
// evita precisar de uma query composta só pra achar o doc certo ao marcar como
// lida (ver js/unread.js). conversationId é o id do canal (servers/.../channels/{id})
// ou da DM (directMessages/{id}).
export const readStatesCol = () => collection(db, 'readStates');
export const readStateDoc = (uid, conversationId) => doc(db, 'readStates', `${uid}_${conversationId}`);
