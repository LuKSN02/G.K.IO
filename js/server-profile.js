// ============================================================
// G.K.IO — Perfil do servidor e Tag do servidor (configurações de servidor)
//  · Perfil: nome, ícone, faixa (cor ou imagem), características (até 5), descrição e jogos.
//  · Tag: até 4 letras/números + ícone + cor, que cada membro escolhe usar (ou não) ao lado do nome.
// Campos novos em servers/{id}: bannerColor, profileTraits[], profileGames[], serverTag{}.
// Em users/{uid}: serverTag { sid } = "uso a tag deste servidor". O texto/cor vêm sempre do servidor.
// ============================================================
import { auth, updateDoc, serverDoc, userDoc } from './db.js';
import { state, el, toast, fallbackAvatar } from './state.js';
import { icon } from './icons.js';
import { uploadToCloudinary } from './cloudinary.js';
import { canManageServerInfo } from './servers.js';

export const BANNER_COLORS = {
  gray: ['#e5e7eb', '#9ca3af'], pink: ['#ff3d9a', '#ff1f78'], red: ['#ef2b2b', '#c81414'], orange: ['#f6862a', '#e0661a'],
  yellow: ['#f7d94c', '#e8bd23'], purple: ['#8e44ad', '#c07bd9'], blue: ['#0ea5ff', '#1d7af3'], teal: ['#4de1c8', '#7ff3e2'],
  green: ['#3f7d0a', '#5aa012'], dark: ['#2b2b2b', '#5b5b5b'],
};
export const bannerGradient = (key) => { const c = BANNER_COLORS[key]; return c ? `linear-gradient(135deg, ${c[0]}, ${c[1]})` : ''; };
export const TAG_ICONS = ['sparkles', 'crown', 'shield', 'bolt', 'flask', 'diamond', 'trophy', 'gamepad', 'users', 'clock'];
export const TAG_COLORS = ['#6C63F5', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#ec4899', '#a855f7', '#94a3b8'];

/** Tag válida de um servidor (ou null). Sempre normalizada: nunca confiar em dados crus de mensagem. */
export function cleanServerTag(t) {
  if (!t || typeof t !== 'object') return null;
  const text = String(t.text || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4);
  if (!text) return null;
  return { text, icon: TAG_ICONS.includes(t.icon) ? t.icon : 'sparkles', color: /^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : TAG_COLORS[0] };
}
/** Chip da tag (reaproveitado no chat e nas prévias). */
export function buildServerTagChip(t) {
  const c = cleanServerTag(t); if (!c) return null;
  return el('span', { class: 'gk-server-tag', style: `--gk-tag:${c.color}`, title: 'Tag do servidor' }, [icon(c.icon, { size: 11 }), c.text]);
}
/** Tag que a pessoa escolheu exibir (vale em qualquer conversa) — ou null. Só vale enquanto ela é membro do servidor. */
export function myServerTagFor() {
  const sid = state.user?.serverTag?.sid;
  if (!sid || !state.servers.has(sid)) return null;
  return cleanServerTag(state.servers.get(sid)?.serverTag);
}

/** Card "Tag do servidor" das configurações de Perfil: escolhe de qual servidor exibir a tag (ou nenhuma). */
export function buildMyServerTagCard() {
  const box = el('div', { class: 'gk-settings-card gk-mytag-card' });
  const paint = () => {
    box.innerHTML = '';
    const cur = state.user?.serverTag?.sid || null;
    const withTag = [...state.servers.values()].map((s) => ({ s, tag: cleanServerTag(s.serverTag) })).filter((x) => x.tag);
    box.appendChild(el('div', { class: 'gk-settings-card-title' }, 'Tag do servidor'));
    box.appendChild(el('div', { class: 'gk-hint', style: 'margin-bottom:12px' }, 'Escolha a tag de um servidor para mostrar ao lado do seu nome nas mensagens — em qualquer conversa. Uma tag por vez.'));
    const choose = async (sid) => {
      try {
        await updateDoc(userDoc(auth.currentUser.uid), { serverTag: sid ? { sid } : null });
        state.user.serverTag = sid ? { sid } : null; paint(); toast(sid ? 'Tag aplicada ao seu perfil.' : 'Tag removida.');
      } catch (e) { toast('Não foi possível salvar: ' + (e.code || e.message) + ' (publicou o firestore.rules novo?)', 'danger'); }
    };
    const row = (key, title, sub, chip) => el('button', { type: 'button', class: 'gk-mytag-row' + ((cur || null) === key ? ' gk-on' : ''), role: 'radio', 'aria-checked': String((cur || null) === key), onclick: () => choose(key) }, [
      el('span', { class: 'gk-mytag-text' }, [el('b', {}, title), sub ? el('small', {}, sub) : null]), chip || null,
      (cur || null) === key ? icon('check', { size: 16 }) : null,
    ]);
    const list = el('div', { class: 'gk-mytag-list', role: 'radiogroup' }, [row(null, 'Nenhuma', 'Não exibir tag de servidor')]);
    for (const { s, tag } of withTag) list.appendChild(row(s.id, s.name || 'Servidor', 'Tag do servidor', buildServerTagChip(tag)));
    box.appendChild(list);
    if (!withTag.length) box.appendChild(el('div', { class: 'gk-hint', style: 'margin-top:10px' }, 'Nenhum dos seus servidores criou uma tag ainda. Quem gerencia o servidor cria em Configurações do servidor › Tag do servidor.'));
  };
  paint(); return box;
}

const MAX_TRAITS = 5, MAX_GAMES = 10;

/** Características + jogos de um servidor, como chips (convite e Comunidades). Retorna null se não houver nada. */
export function buildServerHighlights(server, { maxGames = 3 } = {}) {
  const traits = (Array.isArray(server?.profileTraits) ? server.profileTraits : []).slice(0, MAX_TRAITS)
    .filter((x) => x && typeof x.t === 'string' && x.t.trim());
  const games = (Array.isArray(server?.profileGames) ? server.profileGames : []).filter((g) => typeof g === 'string' && g.trim()).slice(0, MAX_GAMES);
  if (!traits.length && !games.length) return null;
  const extra = games.length - maxGames;
  return el('div', { class: 'gk-svp-hl' }, [
    traits.length ? el('div', { class: 'gk-svp-chips' }, traits.map((x) => el('span', { class: 'gk-svp-trait' }, `${typeof x.e === 'string' && x.e ? x.e.slice(0, 8) + ' ' : ''}${x.t.trim().slice(0, 24)}`))) : null,
    games.length ? el('div', { class: 'gk-svp-chips gk-svp-chips-games' }, [...games.slice(0, maxGames).map((g) => el('span', {}, g.slice(0, 40))), extra > 0 ? el('span', {}, `+${extra}`) : null]) : null,
  ]);
}

// ------------------------------------------------------------
export function renderPerfilServidor(content, header, serverId, appendExtras) {
  const server = state.servers.get(serverId); if (!server) return;
  content.appendChild(header('Perfil do servidor', 'Personalize como seu servidor aparece nos convites e nas comunidades.'));

  const draft = {
    name: server.name || '', description: server.description || '', bannerColor: server.bannerColor || '',
    traits: Array.from({ length: MAX_TRAITS }, (_, i) => ({ e: server.profileTraits?.[i]?.e || '', t: server.profileTraits?.[i]?.t || '' })),
    games: [...(server.profileGames || [])],
    iconFile: null, iconPreview: server.iconUrl || '', bannerFile: null, bannerPreview: server.bannerUrl || '', removeBanner: false,
  };

  // ----- prévia -----
  const preview = el('div', { class: 'gk-svp-preview', 'aria-label': 'Prévia do perfil do servidor' });
  const paintPreview = () => {
    preview.innerHTML = '';
    const bg = draft.bannerPreview && !draft.removeBanner ? `background-image:url(${draft.bannerPreview})` : `background:${bannerGradient(draft.bannerColor) || 'var(--gk-gray-200)'}`;
    const traits = draft.traits.filter((x) => x.t.trim());
    preview.append(
      el('div', { class: 'gk-svp-pv-banner', style: bg }),
      el('div', { class: 'gk-svp-pv-icon' }, [draft.iconPreview ? el('img', { src: draft.iconPreview, alt: '' }) : el('span', {}, (draft.name || '?').slice(0, 2).toUpperCase())]),
      el('div', { class: 'gk-svp-pv-body' }, [
        el('div', { class: 'gk-svp-pv-name' }, draft.name.trim() || 'Servidor'),
        el('div', { class: 'gk-svp-pv-stats' }, [el('span', {}, `${(server.memberIds || []).length} membros`)]),
        draft.description.trim() ? el('div', { class: 'gk-svp-pv-desc' }, draft.description.trim()) : null,
        traits.length ? el('div', { class: 'gk-svp-pv-traits' }, traits.map((x) => el('span', { class: 'gk-svp-trait' }, `${x.e ? x.e + ' ' : ''}${x.t.trim()}`))) : null,
        draft.games.length ? el('div', { class: 'gk-svp-pv-games' }, draft.games.map((g) => el('span', {}, g))) : null,
      ]),
    );
  };

  // ----- nome -----
  const nameIn = el('input', { type: 'text', class: 'gk-sv-input', maxlength: '60', value: draft.name, 'aria-label': 'Nome do servidor' });
  nameIn.addEventListener('input', () => { draft.name = nameIn.value; paintPreview(); });

  // ----- ícone -----
  const iconFile = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  const iconThumb = el('div', { class: 'gk-svp-icon-thumb' });
  const paintIcon = () => { iconThumb.innerHTML = ''; iconThumb.appendChild(draft.iconPreview ? el('img', { src: draft.iconPreview, alt: '' }) : el('span', {}, (draft.name || '?').slice(0, 2).toUpperCase())); };
  iconFile.addEventListener('change', () => { const f = iconFile.files[0]; if (!f) return; draft.iconFile = f; draft.iconPreview = URL.createObjectURL(f); paintIcon(); paintPreview(); });
  paintIcon();

  // ----- faixa -----
  const bannerFile = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  bannerFile.addEventListener('change', () => { const f = bannerFile.files[0]; if (!f) return; draft.bannerFile = f; draft.bannerPreview = URL.createObjectURL(f); draft.removeBanner = false; paintSw(); paintPreview(); });
  const swatches = el('div', { class: 'gk-svp-swatches', role: 'radiogroup', 'aria-label': 'Cor da faixa' });
  const paintSw = () => {
    swatches.innerHTML = '';
    for (const key of Object.keys(BANNER_COLORS)) {
      const on = draft.bannerColor === key && (!draft.bannerPreview || draft.removeBanner);
      const b = el('button', { type: 'button', class: 'gk-svp-sw' + (on ? ' gk-on' : ''), role: 'radio', 'aria-checked': String(on), 'aria-label': key, style: `background:${bannerGradient(key)}` });
      b.addEventListener('click', () => { draft.bannerColor = key; draft.removeBanner = true; draft.bannerFile = null; paintSw(); paintPreview(); });
      swatches.appendChild(b);
    }
  };
  paintSw();

  // ----- características -----
  const traitRows = draft.traits.map((tr, i) => {
    const e = el('input', { type: 'text', class: 'gk-sv-input gk-svp-trait-emoji', maxlength: '8', placeholder: '🙂', value: tr.e, 'aria-label': `Emoji da característica ${i + 1}` });
    const t = el('input', { type: 'text', class: 'gk-sv-input', maxlength: '24', placeholder: 'Ex.: Amigável', value: tr.t, 'aria-label': `Característica ${i + 1}` });
    e.addEventListener('input', () => { tr.e = e.value.trim(); paintPreview(); });
    t.addEventListener('input', () => { tr.t = t.value; paintPreview(); });
    return el('div', { class: 'gk-svp-trait-row' }, [e, t]);
  });

  // ----- descrição -----
  const desc = el('textarea', { class: 'gk-sv-input gk-sv-textarea', maxlength: '200', rows: '3', placeholder: 'Como seu servidor começou? Por que as pessoas devem participar?' });
  desc.value = draft.description;
  const descCount = el('span', { class: 'gk-svp-count' }, `${draft.description.length} / 200`);
  desc.addEventListener('input', () => { draft.description = desc.value; descCount.textContent = `${desc.value.length} / 200`; paintPreview(); });

  // ----- jogos -----
  const gamesBox = el('div', { class: 'gk-svp-games' });
  const gameIn = el('input', { type: 'text', class: 'gk-sv-input', maxlength: '40', placeholder: 'Digite um jogo e aperte Enter…', 'aria-label': 'Adicionar jogo' });
  const paintGames = () => {
    gamesBox.innerHTML = '';
    draft.games.forEach((g, i) => gamesBox.appendChild(el('span', { class: 'gk-svp-game' }, [g, el('button', { type: 'button', 'aria-label': `Remover ${g}`, onclick: () => { draft.games.splice(i, 1); paintGames(); paintPreview(); } }, [icon('close', { size: 11 })])])));
  };
  gameIn.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return; ev.preventDefault();
    const v = gameIn.value.trim(); if (!v) return;
    if (draft.games.length >= MAX_GAMES) return toast(`No máximo ${MAX_GAMES} jogos.`, 'danger');
    if (!draft.games.some((g) => g.toLowerCase() === v.toLowerCase())) draft.games.push(v);
    gameIn.value = ''; paintGames(); paintPreview();
  });
  paintGames();

  const section = (title, sub, ...kids) => el('div', { class: 'gk-svp-block' }, [el('div', { class: 'gk-svp-h' }, title), sub ? el('div', { class: 'gk-svp-sub' }, sub) : null, ...kids]);
  const save = el('button', { class: 'gk-btn gk-btn-primary', type: 'button' }, 'Salvar alterações');
  save.addEventListener('click', async () => {
    save.disabled = true; const label = save.textContent;
    try {
      const patch = {
        name: draft.name.trim() || 'Servidor sem nome', description: draft.description.trim().slice(0, 200),
        bannerColor: draft.bannerColor || '',
        profileTraits: draft.traits.filter((x) => x.t.trim()).map((x) => ({ e: x.e.slice(0, 8), t: x.t.trim().slice(0, 24) })),
        profileGames: draft.games.slice(0, MAX_GAMES),
      };
      if (draft.iconFile) { save.textContent = 'Enviando ícone…'; patch.iconUrl = (await uploadToCloudinary(draft.iconFile, `server-icons/${auth.currentUser.uid}`)).url; }
      if (draft.bannerFile) { save.textContent = 'Enviando imagem…'; patch.bannerUrl = (await uploadToCloudinary(draft.bannerFile, `server-banners/${auth.currentUser.uid}`)).url; }
      else if (draft.removeBanner) patch.bannerUrl = '';
      await updateDoc(serverDoc(serverId), patch);
      Object.assign(server, patch);
      const t = document.getElementById('gk-sidebar-header-title'); if (t) t.textContent = patch.name;
      draft.iconFile = null; draft.bannerFile = null;
      toast('Perfil do servidor salvo.');
    } catch (err) { toast('Não foi possível salvar: ' + (err.code || err.message || err), 'danger'); }
    finally { save.disabled = false; save.textContent = label; }
  });

  const form = el('div', { class: 'gk-svp-form' }, [
    section('Nome', null, nameIn),
    section('Ícone', 'Recomendamos uma imagem de pelo menos 512×512.', el('div', { class: 'gk-svp-icon-row' }, [
      iconThumb,
      el('button', { class: 'gk-btn gk-btn-primary gk-btn-sm', type: 'button', onclick: () => iconFile.click() }, 'Alterar o ícone do servidor'),
      el('button', { class: 'gk-btn gk-btn-ghost gk-btn-sm', type: 'button', onclick: () => { draft.iconFile = null; draft.iconPreview = ''; paintIcon(); paintPreview(); } }, 'Remover o ícone'),
      iconFile,
    ])),
    section('Faixa', 'Escolha uma cor ou envie uma imagem.', swatches, el('div', { class: 'gk-svp-icon-row', style: 'margin-top:10px' }, [
      el('button', { class: 'gk-btn gk-btn-ghost gk-btn-sm', type: 'button', onclick: () => bannerFile.click() }, 'Usar uma imagem'),
      bannerFile,
    ])),
    section('Características', `Adicione até ${MAX_TRAITS} características para mostrar os interesses e a personalidade do seu servidor.`, el('div', { class: 'gk-svp-traits' }, traitRows)),
    section('Descrição', 'Como seu servidor começou? Por que as pessoas devem participar?', desc, descCount),
    section('Jogos jogados', 'Quais jogos os seus membros estão jogando?', gameIn, gamesBox),
    el('div', { class: 'gk-svp-save' }, [save]),
  ]);
  content.appendChild(el('div', { class: 'gk-svp-layout' }, [form, el('div', { class: 'gk-svp-side' }, [preview])]));
  paintPreview();
  if (appendExtras) appendExtras(content);
}

// ------------------------------------------------------------
export function renderTagServidor(content, header, serverId) {
  const server = state.servers.get(serverId); if (!server) return;
  content.appendChild(header('Tag do servidor', 'Uma tag curta que os membros podem exibir ao lado do nome nas mensagens.'));
  const cur = cleanServerTag(server.serverTag);
  const draft = { text: cur?.text || '', icon: cur?.icon || TAG_ICONS[0], color: cur?.color || TAG_COLORS[0] };
  const chipHolder = el('span', { class: 'gk-svp-chip-holder' });
  const paintChip = () => { chipHolder.innerHTML = ''; const c = buildServerTagChip(draft); chipHolder.appendChild(c || el('span', { class: 'gk-svp-sub' }, 'Digite a tag para ver a prévia')); };

  // ----- editor (quem gerencia o servidor) -----
  if (canManageServerInfo(serverId)) {
    const textIn = el('input', { type: 'text', class: 'gk-sv-input gk-svp-tag-input', maxlength: '4', placeholder: 'WUMP', value: draft.text, 'aria-label': 'Texto da tag' });
    textIn.addEventListener('input', () => { textIn.value = textIn.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase(); draft.text = textIn.value; paintChip(); });
    const icons = el('div', { class: 'gk-svp-tag-icons' });
    const colors = el('div', { class: 'gk-svp-swatches gk-svp-tag-colors' });
    const paintPick = () => {
      icons.innerHTML = ''; colors.innerHTML = '';
      for (const n of TAG_ICONS) icons.appendChild(el('button', { type: 'button', class: 'gk-svp-tag-ic' + (draft.icon === n ? ' gk-on' : ''), 'aria-label': n, onclick: () => { draft.icon = n; paintPick(); paintChip(); } }, [icon(n, { size: 20 })]));
      for (const c of TAG_COLORS) colors.appendChild(el('button', { type: 'button', class: 'gk-svp-sw' + (draft.color === c ? ' gk-on' : ''), 'aria-label': c, style: `background:${c}`, onclick: () => { draft.color = c; paintPick(); paintChip(); } }));
    };
    paintPick(); paintChip();
    const saveTag = el('button', { class: 'gk-btn gk-btn-primary', type: 'button' }, 'Salvar tag');
    saveTag.addEventListener('click', async () => {
      const tag = cleanServerTag(draft); if (!tag) return toast('Digite de 1 a 4 letras ou números.', 'danger');
      saveTag.disabled = true;
      try { await updateDoc(serverDoc(serverId), { serverTag: tag }); server.serverTag = tag; toast('Tag salva.'); } catch (e) { toast('Não foi possível salvar: ' + (e.code || e.message), 'danger'); } finally { saveTag.disabled = false; }
    });
    const removeTag = el('button', { class: 'gk-btn gk-btn-ghost', type: 'button' }, 'Remover tag');
    removeTag.addEventListener('click', async () => {
      try { await updateDoc(serverDoc(serverId), { serverTag: null }); server.serverTag = null; toast('Tag removida.'); content.innerHTML = ''; renderTagServidor(content, header, serverId); } catch (e) { toast('Não foi possível remover: ' + (e.code || e.message), 'danger'); }
    });
    content.appendChild(el('div', { class: 'gk-svp-layout' }, [
      el('div', { class: 'gk-svp-form' }, [
        el('div', { class: 'gk-svp-block' }, [el('div', { class: 'gk-svp-h' }, 'Escolha um nome'), el('div', { class: 'gk-svp-sub' }, 'No máximo 4 caracteres, entre letras e números.'), textIn]),
        el('div', { class: 'gk-svp-block' }, [el('div', { class: 'gk-svp-h' }, 'Escolha uma insígnia'), icons]),
        el('div', { class: 'gk-svp-block' }, [el('div', { class: 'gk-svp-h' }, 'Escolha a cor'), colors]),
        el('div', { class: 'gk-svp-save' }, [cur ? removeTag : null, saveTag]),
      ]),
      el('div', { class: 'gk-svp-side' }, [el('div', { class: 'gk-svp-tag-preview' }, [
        el('div', { class: 'gk-svp-tag-msg' }, [el('b', {}, state.user?.displayName || state.user?.username || 'Você'), ' ', chipHolder]),
        el('div', { class: 'gk-svp-sub' }, 'Assim aparece ao lado do seu nome.'),
      ])]),
    ]));
  }

  // ----- usar a tag (qualquer membro) -----
  const tag = cleanServerTag(server.serverTag);
  const usingNow = () => state.user?.serverTag?.sid === serverId;
  const toggle = el('input', { type: 'checkbox' }); toggle.checked = usingNow(); toggle.disabled = !tag;
  toggle.addEventListener('change', async () => {
    const on = toggle.checked;
    try {
      await updateDoc(userDoc(auth.currentUser.uid), { serverTag: on ? { sid: serverId } : null });
      state.user.serverTag = on ? { sid: serverId } : null;
      toast(on ? 'Agora você exibe a tag deste servidor.' : 'Tag removida do seu nome.');
    } catch (e) { toggle.checked = !on; toast('Não foi possível alterar: ' + (e.code || e.message) + ' (publicou o firestore.rules novo?)', 'danger'); }
  });
  content.appendChild(el('div', { class: 'gk-sv-card', style: 'margin-top:16px' }, [
    el('label', { class: 'gk-nsfw-option' }, [toggle, el('span', {}, [
      el('strong', {}, 'Usar a tag deste servidor'),
      el('small', {}, tag ? 'Ela aparece ao lado do seu nome nas mensagens, em qualquer conversa. Você só pode usar a tag de um servidor por vez (também dá para trocar em Perfil).' : 'Este servidor ainda não criou uma tag.'),
    ])]),
    tag ? el('div', { style: 'margin-top:10px' }, [buildServerTagChip(tag)]) : null,
  ]));
}
