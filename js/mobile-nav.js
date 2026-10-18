// ============================================================
// G.K.IO — Navegação no celular (≤ 900px)
//
// Antes: rail + lista de conversas viviam numa gaveta escondida atrás do
// botão ☰, e duas barras empilhadas no topo. Quem abria o app via uma tela
// vazia e não sabia por onde ir.
//
// Agora o app se comporta como um mensageiro:
//   • barra de abas fixa embaixo (Início, Mensagens, Servidor, ...)
//   • "lista"  → a lista de conversas/canais ocupa a tela inteira
//   • "chat"   → conversa em tela cheia, com botão ← para voltar à lista
//   • "página" → Início, Arquivos, Comunidades, Amigos
// O modo vai em <html data-mnav="list|chat|page"> e o CSS faz o resto
// (ver "Navegação mobile" no fim de css/app.css). Em telas grandes nada muda.
// ============================================================
import { state, el } from './state.js';
import { icon } from './icons.js';

const MQ = window.matchMedia('(max-width: 900px)');
const root = document.documentElement;

let forceList = false;   // voltou da conversa para a lista (botão ← ou botão Voltar do celular)
let forcedMain = false;  // pediu a tela de Amigos estando em Mensagens
let sig = '';
let mode = '';

const conversationOpen = () => (
  state.currentView === 'dms' ? !!state.currentDmId
    : state.currentView === 'server' ? !!state.currentChannelId
      : false
);
const signature = () => [state.currentView, state.currentDmId, state.currentChannelId].join('|');

function compute() {
  if (!MQ.matches) return '';
  const v = state.currentView;
  if (v === 'server-picker') return 'list';       // a lista de servidores mora na sidebar
  if (v !== 'dms' && v !== 'server') return 'page';
  if (forceList) return 'list';
  if (conversationOpen()) return 'chat';
  return forcedMain ? 'page' : 'list';
}

export function updateMobileNav() {
  const s = signature();
  if (s !== sig) { sig = s; forceList = false; forcedMain = false; } // mudou de conversa/visão: recomeça
  const next = compute();
  if (next !== mode) {
    const was = mode;
    mode = next;
    if (next) root.dataset.mnav = next; else delete root.dataset.mnav;
    // O botão Voltar do celular/navegador deve sair da conversa, não do app.
    if (next === 'chat' && was !== 'chat') { try { history.pushState({ gk: 'chat' }, ''); } catch (e) { /* noop */ } }
  }
  root.dataset.mview = state.currentView || '';
}

function goBackToList() {
  if (history.state && history.state.gk === 'chat') { history.back(); return; } // dispara popstate
  forceList = true; updateMobileNav();
}

export function initMobileNav() {
  // Botão ← no topo da conversa
  const topbar = document.querySelector('.gk-topbar');
  if (topbar && !document.getElementById('gk-mobile-back-btn')) {
    const back = el('button', { id: 'gk-mobile-back-btn', class: 'gk-icon-btn gk-mobile-back-btn', type: 'button', title: 'Voltar', 'aria-label': 'Voltar para a lista', onclick: goBackToList }, [icon('chevronLeft', { size: 22 })]);
    topbar.insertBefore(back, topbar.firstChild);
  }
  // Atalho para Amigos no cabeçalho da lista de Mensagens
  const headerBtns = document.querySelector('.gk-sidebar-header > div');
  if (headerBtns && !document.getElementById('gk-mobile-friends-btn')) {
    const btn = el('button', { id: 'gk-mobile-friends-btn', class: 'gk-mobile-friends-btn', type: 'button', title: 'Amigos', 'aria-label': 'Amigos' }, [icon('members', { size: 18 })]);
    btn.addEventListener('click', async () => {
      const { goToDmsView } = await import('./dms.js');
      goToDmsView();            // limpa a conversa e mostra a tela de Amigos
      forcedMain = true; sig = signature(); updateMobileNav();
    });
    headerBtns.insertBefore(btn, headerBtns.firstChild);
  }
  // Tocar numa conversa/canal da lista sempre abre o chat (mesmo a que já estava aberta)
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('#gk-sidebar-body .gk-dm-row, #gk-sidebar-body .gk-channel')) {
      forceList = false; forcedMain = false; setTimeout(updateMobileNav, 0);
    }
  }, true);
  window.addEventListener('popstate', () => { if (mode === 'chat') { forceList = true; updateMobileNav(); } });
  MQ.addEventListener('change', updateMobileNav);
  // O estado do app (state.*) muda por vários caminhos (cliques, notificações,
  // atalhos); conferir de vez em quando é mais robusto do que interceptar todos.
  setInterval(updateMobileNav, 200);
  updateMobileNav();
}
