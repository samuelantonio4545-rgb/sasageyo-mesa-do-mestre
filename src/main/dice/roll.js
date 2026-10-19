// Rollem v1 grammar from @rollem/language 2.11.3 (MIT), with bounded work.
const engine = require('./vendor/rollem');

function rollMessage(content) {
  if (typeof content !== 'string' || content.length > 500) return null;
  const explicit = /^!(?:roll|r|rolar)\s+/i.test(content);
  content = content.replace(/^!(?:roll|r|rolar)\s+/i, '').trim();
  const inline = [...content.matchAll(/\[([^\[\]]+)\]/g)].map(m => m[1]);
  const expressions = inline.length ? inline : [content];
  if (expressions.length > 10) return 'Limite: 10 expressões por mensagem.';
  const lines = [];
  let rolls = 0;
  for (let expression of expressions) {
    const spoiler = /^s#/i.test(expression);
    expression = expression.replace(/^s#/i, '');
    const repeat = expression.match(/^(\d+)#\s*(.*)$/);
    const count = repeat ? Number(repeat[1]) : 1;
    if (repeat) expression = repeat[2];
    if (!count || count > 100 || rolls + count > 100) return 'Limite: 100 rolagens por mensagem.';
    for (let i = 0; i < count; i++) {
      let result;
      try { result = engine.parse(expression); }
      catch (error) {
        if (error.location === 'CUSTOM') return String(error.message).slice(0,300);
        return explicit ? 'Expressão inválida. Exemplo: !roll 2d20kh1+5' : null;
      }
      if (result.depth <= 1 || (!explicit && !inline.length && result.dice < 1)) return null;
      const value = typeof result.value === 'boolean' ? (result.value ? '**Success!**' : '**Failure!**') : '` ' + result.value + ' `';
      let line = (result.label ? "'" + result.label + "', " : '') + value + ' ⟵ ' + result.pretties.split(']').join('] ');
      if (spoiler) line = '||' + line + '||';
      lines.push(line);
      rolls++;
      if (lines.join('\n').length > 1800) return 'Resultado muito longo. Reduza a quantidade de dados ou repetições.';
    }
  }
  return lines.length ? lines.join('\n') : null;
}

/** @param {(message: string) => void} reportError */
function createDiceHandler(reportError = () => {}) {
  const cooldown = new Map();
  return async message => {
    if (!message.guildId || message.author.bot || message.webhookId) return;
    const now = Date.now();
    const key = message.guildId + ':' + message.author.id;
    if (now - (cooldown.get(key) || 0) < 1500) return;
    for (const [id, time] of cooldown) if (now-time > 60000) cooldown.delete(id);
    const result = rollMessage(message.content);
    if (!result) return;
    cooldown.set(key, now);
    try { await message.reply({content: result, allowedMentions: {parse: [], repliedUser: false}}); }
    catch { reportError('Não consegui enviar os dados. Confira Ver canais, Enviar mensagens e Ler histórico no canal.'); }
  };
}
module.exports = {rollMessage, createDiceHandler};
