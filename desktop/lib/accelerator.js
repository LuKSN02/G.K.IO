// "Ctrl+Shift+M" (formato do G.K.IO) -> "Control+Shift+M" (formato do Electron)
const KEYS = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backquote: '`', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/',
  Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Numpad0: 'num0', Numpad1: 'num1', Numpad2: 'num2', Numpad3: 'num3', Numpad4: 'num4',
  Numpad5: 'num5', Numpad6: 'num6', Numpad7: 'num7', Numpad8: 'num8', Numpad9: 'num9',
};
function toAccelerator(combo) {
  if (!combo) return null;
  const parts = combo.split('+');
  const key = parts.pop();
  const mods = parts.map((m) => (m === 'Ctrl' ? 'Control' : m === 'Meta' ? 'Super' : m));
  const k = KEYS[key] || key;
  if (!/^([A-Z0-9]|F\d{1,2}|[`\-=,./;'\[\]\\]|Space|Enter|Tab|Up|Down|Left|Right|num\d)$/.test(k)) return null;
  return [...mods, k].join('+');
}
module.exports = { toAccelerator };
