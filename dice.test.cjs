const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {rollMessage,createDiceHandler}=require('./src/main/dice/roll');
test('syntax, totals, keep/drop, fate, labels, inline and repeat',()=>{
 const original=crypto.randomInt; crypto.randomInt=()=>3;
 try {
  assert.match(rollMessage('2d6+3 ataque'), /11.*⟵/);
  assert.match(rollMessage('2d20kh1'), /` 4 `/);
  assert.match(rollMessage('2d20kl1'), /` 4 `/);
  assert.match(rollMessage('4d6dl1'), /` 12 `/);
  assert.equal(rollMessage('6#4d6kh3').split('\n').length,6);
  assert.equal(rollMessage('ataque [d20] dano [2d6]').split('\n').length,2);
  assert.match(rollMessage('s#d20'), /^\|\|.*\|\|$/);
  assert.match(rollMessage('!roll (2+3)*4'), /` 20 `/);
  assert.match(rollMessage('d20>3'), /Success/);
  assert.equal(rollMessage('olá pessoal'),null);
  assert.equal(rollMessage('2026'),null);
 } finally {crypto.randomInt=original;}
 assert.match(rollMessage('4dF'), /4dF/);
});
test('bounded malformed and explosive requests',()=>{
 assert.match(rollMessage('!roll errado'),/inválida/);
 assert.match(rollMessage('101#d20'),/Limite/);
 assert.equal(rollMessage('x'.repeat(501)),null);
 assert.match(rollMessage('d1000001'),/Limite/);
 const original=crypto.randomInt; crypto.randomInt=()=>5;
 try { assert.match(rollMessage('d6!'),/Limite/); } finally {crypto.randomInt=original;}
});
test('Discord replies: no bots, webhooks, DMs, mentions or duplicate bursts',async()=>{
 const replies=[]; const errors=[];
 const handler=createDiceHandler(e=>errors.push(e));
 const m={guildId:'server',author:{id:'user',bot:false},content:'d20 @everyone',reply:async p=>replies.push(p)};
 await handler({...m,author:{...m.author,bot:true}});
 await handler({...m,webhookId:'hook'}); await handler({...m,guildId:null});
 assert.equal(replies.length,0);
 await handler(m); await handler(m); assert.equal(replies.length,1);
 assert.deepEqual(replies[0].allowedMentions,{parse:[],repliedUser:false});
 await handler({...m,author:{id:'other',bot:false},reply:async()=>{throw Error('403')}});
 assert.equal(errors.length,1);
});
