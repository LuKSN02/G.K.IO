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
