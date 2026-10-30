// ============================================================
// G.K.IO — Configurações no celular (≤ 900px)
//
// No desktop as configurações são "menu à esquerda + conteúdo à direita".
// No celular isso não cabe: o menu virava uma pilha enorme e empurrava o
// conteúdo para fora da tela. Aqui ele vira navegação em dois níveis, igual
// às configurações do Android/iOS:
//   • "lista"   → só as seções (Perfil, Conta, Áudio & Vídeo…) em tela cheia
//   • "detalhe" → só a seção escolhida, com barra de título e botão ←
// O estado vai em data-mview no .gk-settings-shell e o CSS faz o resto
// (ver "Configurações no celular" em css/app.css). No desktop nada muda.
// ============================================================
import { el } from './state.js';
import { icon } from './icons.js';

export const isMobileSettings = () => window.matchMedia('(max-width: 900px)').matches;

// Cria (uma vez) a barra de título do celular dentro do shell e devolve
// { showList(title), showDetail(title) }.
export function initMobileSettings(shellId) {
  const shell = document.getElementById(shellId);
  if (!shell) return { showList() {}, showDetail() {} };

  let bar = shell.querySelector('.gk-settings-mbar');
  if (!bar) {
    const back = el('button', {
      class: 'gk-settings-mback', type: 'button', 'aria-label': 'Voltar para as configurações', title: 'Voltar',
      onclick: () => { shell.dataset.mview = 'list'; setTitle(shell.dataset.listTitle || 'Configurações'); },
    }, [icon('chevronLeft', { size: 22 })]);
    bar = el('div', { class: 'gk-settings-mbar' }, [back, el('div', { class: 'gk-settings-mtitle' })]);
    shell.insertBefore(bar, shell.firstChild);
  }
  const setTitle = (t) => { bar.querySelector('.gk-settings-mtitle').textContent = t || ''; };

  return {
    // Mostra a lista de seções (ao abrir as configurações)
    showList(title) {
      shell.dataset.listTitle = title;
      shell.dataset.mview = 'list';
      setTitle(title);
    },
    // Mostra o conteúdo de uma seção (ao tocar num item do menu)
    showDetail(title) {
      shell.dataset.mview = 'detail';
      setTitle(title);
      const content = shell.querySelector('.gk-settings-content');
      if (content) content.scrollTop = 0;
    },
  };
}
