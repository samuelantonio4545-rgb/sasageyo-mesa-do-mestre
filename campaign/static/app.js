'use strict';
let state, view = 'audio', filter = '', category = '', editing = null, folderId = '';
const sectionOf = i => i.section || (i.kind==='personagem'?'personagens':i.kind==='musica'?'audio':'outros');
let playerSyncing = false;
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels = {ambientacao:'Ambientação',outros:'Outros',mesa:'Mesa de jogo',biblioteca:'Biblioteca',personagens:'Personagens',audio:'Áudio & efeitos',agenda:'Agenda',notas:'Diário privado',conexoes:'Conexões'};
const names = {pasta:'Pasta',personagem:'Personagem',imagem:'Imagem / documento',musica:'Música / efeito',cena:'Cena',nota:'Nota privada'};
const icons = {pasta:'📁',personagem:'♙',imagem:'▧',musica:'♫',cena:'◈',nota:'✎'};
const imageFile = file => /\.(png|jpe?g|webp|gif)$/i.test(file || '');
const fileUrl = file => '/files/' + encodeURIComponent(file);
const date = stamp => new Date(stamp * 1000).toLocaleString('pt-BR', {dateStyle:'short',timeStyle:'short'});
async function api(path, body) {
  const res = await fetch('/api/' + path, body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json','X-Mesa':'local'},body:JSON.stringify(body)});
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Não foi possível concluir.');
  return result;
}
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').hidden = true, 6500); }
async function refresh(renderPage = true) { state = await api('state'); $('#campaign-name').textContent = state.settings.campaign; $('#connection-status').textContent = state.connected ? '● Bot conectado' : '○ Bot desconectado'; if(renderPage) render(); }
function navigate(next) { view = next; folderId = ''; filter = ''; category = ''; $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view)); $('#crumb').textContent = labels[view]; render(); }
function head(title, description, button = '') { return `<div class="page-head"><div><div class="eyebrow">${esc(state.settings.campaign)}</div><h1>${title}</h1><p class="muted">${description}</p></div>${button}</div>`; }
function addButton(kind, text='Adicionar') { return `<button class="primary" data-action="new" data-kind="${kind}">+ ${text}</button>`; }
function empty(kind, title, text) { return `<div class="empty"><div class="empty-icon">${icons[kind]}</div><h3>${title}</h3><p>${text}</p>${addButton(kind, 'Criar primeiro item')}</div>`; }
function card(item) {
  const art = imageFile(item.file) ? `<img src="${fileUrl(item.file)}" alt="${esc(item.title)}" loading="lazy">` : icons[item.kind];
  let action = item.kind === 'nota' ? '' : `<button class="primary" data-action="reveal" data-id="${esc(item.id)}">${item.kind === 'musica' ? '▶ Tocar no player' : '↗ Revelar'}</button>`;
  if(item.kind === 'musica' && !item.kenku_id) action = '<span class="muted">Associe um ID do Kenku para tocar.</span>';
  if(item.kind === 'musica' && item.kenku_type === 'soundboard' && item.kenku_id) action += `<button data-action="stop-effect" data-id="${esc(item.id)}">■ Parar</button>`;
  const link = item.url ? `<a class="button" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Abrir link ↗</a>` : '';
  const localAudio = item.kind === 'musica' && /\.(mp3|ogg|wav|m4a)$/i.test(item.file) ? `<small>Prévia local · não transmite ao Discord</small><audio controls preload="none" src="${fileUrl(item.file)}"></audio>` : '';
  return `<article class="card"><div class="art ${item.kind}">${art}</div><div class="card-body"><span class="tag">${esc(item.category || names[item.kind])}</span><h3>${esc(item.title)}</h3><p>${esc((item.kind === 'nota' ? item.private || item.description : item.description || item.affiliation || 'Pronto para preparar sua próxima sessão.').slice(0,150))}</p>${localAudio}${item.tags ? `<small>${esc(item.tags)}</small>` : ''}</div><div class="actions">${action}${link}${item.file ? `<a class="button" href="${fileUrl(item.file)}" target="_blank" rel="noopener">Arquivo ↗</a>` : ''}<button data-action="edit" data-id="${esc(item.id)}" aria-label="Editar ${esc(item.title)}">Editar</button><button class="danger" data-action="delete" data-id="${esc(item.id)}" aria-label="Excluir ${esc(item.title)}">×</button></div></article>`;
}
function collection(items, kind, title, text) { return items.length ? `<div class="grid">${items.map(card).join('')}</div>` : empty(kind,title,text); }
function filtered(items) { const needle=filter.toLocaleLowerCase();return items.filter(i=>(view==='notas'||(i.folder_id||'')===folderId) && (!category || i.category === category) && [i.title,i.category,i.tags,i.affiliation].join(' ').toLocaleLowerCase().includes(needle)); }
function toolbar(items) { const categories=[...new Set(items.map(i=>i.category).filter(Boolean))].sort();return `<div class="toolbar"><input id="search" aria-label="Buscar no acervo" placeholder="Buscar por nome, categoria ou etiqueta…" value="${esc(filter)}"><select id="category" aria-label="Filtrar categoria"><option value="">Todas as categorias</option>${categories.map(c=>`<option ${c===category?'selected':''}>${esc(c)}</option>`).join('')}</select></div>`; }
function audioShelf(items, effects=false){
  const title=effects?'Soundboards':'Playlists';
  return `<section class="audio-shelf"><div class="shelf-heading"><h2>${title}<button class="round-add" data-action="new-audio" data-type="${effects?'soundboard':'playlist'}" aria-label="Adicionar ${effects?'efeito':'playlist'}">+</button></h2><span class="shelf-count">${items.length} ${items.length===1?'item':'itens'}</span></div><div class="cover-grid">${items.map((i,index)=>`<article class="cover-item"><div class="music-cover cover-${index%4}">${imageFile(i.file)?`<img src="${fileUrl(i.file)}" alt="${esc(i.title)}" loading="lazy">`:'<span class="cover-symbol">'+(effects?'✦':'♫')+'</span>'}<div class="cover-overlay"><span>${esc(i.title)}</span><button data-action="${i.kenku_id?'reveal':'edit'}" data-id="${esc(i.id)}" aria-label="${i.kenku_id?'Tocar':'Configurar'} ${esc(i.title)}">${i.kenku_id?'▶':'+'}</button></div></div><div class="cover-meta"><span>${esc(i.category|| (effects?'Efeito':'Trilha'))}</span><button data-action="edit" data-id="${esc(i.id)}" aria-label="Editar ${esc(i.title)}">•••</button></div><div class="cover-options">${i.url?`<a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">Abrir link ↗</a>`:''}${effects&&i.kenku_id?`<button data-action="stop-effect" data-id="${esc(i.id)}">■ Parar efeito</button>`:''}</div></article>`).join('')}<button class="cover-add" data-action="new-audio" data-type="${effects?'soundboard':'playlist'}"><span>+</span>${effects?'Adicionar efeito':'Adicionar playlist'}<small>${effects?'Sons para cada momento':'Uma trilha para cada cenário'}</small></button></div></section>`;
}
function audioCollection(items){return audioShelf(items.filter(i=>i.kenku_type!=='soundboard'))+audioShelf(items.filter(i=>i.kenku_type==='soundboard'),true);}
const minutes = seconds => { const n=Math.max(0,Math.floor(Number(seconds)||0));return Math.floor(n/60)+':'+String(n%60).padStart(2,'0'); };
async function syncPlayer(notify=false){
  if(playerSyncing)return;
  playerSyncing=true;
  try{const playback=await api('kenku',{action:'state'});$('#track-title').textContent=playback.track?.title||'Nenhuma faixa selecionada';$('#track-subtitle').textContent=playback.playlist?.title||'Player integrado conectado';const toggle=$('#player-toggle');toggle.dataset.command=playback.playing?'pause':'resume';toggle.textContent=playback.playing?'Ⅱ':'▶';toggle.setAttribute('aria-label',playback.playing?'Pausar':'Reproduzir');toggle.title=playback.playing?'Pausar':'Reproduzir';const duration=Number(playback.track?.duration)||0;$('#track-progress').max=duration||1;$('#track-progress').value=Number(playback.track?.progress)||0;$('#track-elapsed').textContent=minutes(playback.track?.progress);$('#track-duration').textContent=duration?minutes(duration):'—:—';if(document.activeElement!==$('#player-volume')){const volume=Math.round((playback.volume??.7)*100);$('#player-volume').value=volume;$('#volume-value').textContent=volume+'%';}}
  catch(e){$('#track-title').textContent='Player indisponível';$('#track-subtitle').textContent='Abra a aba do player integrado para iniciar';$('#track-progress').value=0;$('#track-elapsed').textContent='0:00';$('#track-duration').textContent='—:—';$('#player-toggle').dataset.command='resume';$('#player-toggle').textContent='▶';$('#player-toggle').title='Reproduzir';$('#player-toggle').setAttribute('aria-label','Reproduzir');if(notify)toast(e.message);}
  finally{playerSyncing=false;}
}
function render() {
  const items=state.items;
  let html='';
  if(view==='mesa') {
    const scenes=items.filter(i=>i.kind==='cena');
    const pending=state.jobs.filter(j=>j.status==='pendente');
    html=`<div class="hero"><div><div class="eyebrow">A PRÓXIMA HISTÓRIA COMEÇA AQUI</div><h1>Sua mesa. Seu universo.</h1><p class="muted">Prepare os encontros, dê voz aos personagens e revele cada detalhe no momento certo.</p><div class="actions">${addButton('cena','Preparar uma cena')}<button class="secondary" data-action="poll">Agendar sessão</button></div></div><div class="hero-mark" aria-hidden="true">✧</div></div>
    <div class="stats"><div class="stat"><span>CENAS PREPARADAS</span><strong>${scenes.length.toString().padStart(2,'0')}</strong></div><div class="stat"><span>PERSONAGENS</span><strong>${items.filter(i=>i.kind==='personagem').length.toString().padStart(2,'0')}</strong></div><div class="stat"><span>TRILHAS & EFEITOS</span><strong>${items.filter(i=>i.kind==='musica').length.toString().padStart(2,'0')}</strong></div><div class="stat"><span>DISPAROS AGENDADOS</span><strong>${pending.length.toString().padStart(2,'0')}</strong></div></div>
    ${!state.connected?'<div class="notice">Conecte seu bot em <strong>Conexões</strong> para publicar no Discord. Você já pode organizar todo o material aqui.</div>':''}
    <div class="section-head"><h2>Cenas da campanha</h2><span class="tag">PREPARAR → REVELAR</span></div>${collection(scenes,'cena','O palco está pronto. Falta a sua história.','Monte uma cena com apresentação, personagens, imagens e áudio. Tudo fica privado até você disparar.')}
    <div class="section-head"><h2>Últimos acontecimentos</h2></div>${state.history.length ? state.history.slice(0,5).map(h=>`<div class="history"><span>${esc(h.label)} · ${esc(h.detail)}</span><span>${date(h.at)}</span></div>`).join('') : '<p class="muted">Seus disparos aparecerão aqui. Nenhuma mensagem foi enviada ainda.</p>'}`;
  } else if(['biblioteca','ambientacao','outros','personagens','audio','notas'].includes(view)) {
    const kind={ambientacao:'imagem',outros:'imagem',biblioteca:'imagem',personagens:'personagem',audio:'musica',notas:'nota'}[view];
    const descriptions={ambientacao:'Cenários, mapas e imagens para dar vida à sessão.',outros:'Documentos e outras referências da campanha.',biblioteca:'Mapas, retratos, documentos e referências em um só acervo.',personagens:'Aliados, rivais e desconhecidos. Os segredos ficam com você.',audio:'Organize suas trilhas e controle o player integrado.',notas:'Acontecimentos, pistas e planos. Este diário é só seu.'};
    const selected=items.filter(i=>i.kind!=='pasta' && (view==='notas'?i.kind===kind:sectionOf(i)===view));
    html=head(labels[view],descriptions[view],addButton(kind,'Adicionar item'));
    if(view==='audio') html=`<div class="audio-intro"><div><h1>Sua trilha de aventura</h1><p class="muted">O som certo, no momento certo.</p></div><button data-action="kenku-library">↻ Importar do player</button></div><div id="kenku-status" class="muted"></div><div id="kenku-library" class="kenku-list"></div>`;
    html+=folderNavigation()+toolbar(selected)+`<div id="collection">${view==='audio'?audioCollection(filtered(selected)):collection(filtered(selected),kind,'Seu acervo começa aqui.','Adicione seus materiais, organize por categoria e encontre tudo quando precisar.')}</div>`;
    if(view==='audio')html+='<p class="audio-hint">Abra YouTube e Spotify pelos atalhos na barra lateral do aplicativo. Para transmitir, selecione o canal de voz em Output. Os controles abaixo operam suas faixas locais.</p>';
  } else if(view==='agenda') {
    html=head('O próximo encontro','Disponibilidade do grupo, revelações agendadas e histórico de envios.','<div class="actions"><button data-action="session">Confirmar sessão</button><button class="primary" data-action="poll">+ Nova enquete</button></div>')+
    '<div class="notice">Mantenha o programa aberto para os disparos acontecerem. Envios vencidos serão processados ao reconectar o bot. Se ocorrer uma falha, confira o Discord antes de criar outro disparo. A repetição semanal preserva as mesmas opções.</div>'+
    (state.jobs.length?state.jobs.map(j=>`<article class="job"><div><span class="badge ${esc(j.status)}">${esc(j.status)}</span><h3>${esc(j.body.title)}</h3><p class="muted">${date(j.due)}${j.body.weekly?' · Repete a cada 7 dias':''}</p>${j.result?`<p class="muted">${esc(j.result)}</p>`:''}${j.status==='pendente'&&!state.connected?'<small>Aguardando horário e conexão do bot.</small>':''}</div><div class="actions">${j.status==='pendente'?`<button data-action="cancel-job" data-id="${j.id}">Cancelar disparo</button>`:''}${j.body.sent.some(s=>s.poll)?`<button data-action="results" data-id="${j.id}">Ver votação</button>`:''}</div></article>`).join('') : empty('cena','Ainda sem compromissos.','Crie uma enquete para combinar a sessão. Para agendar uma revelação, abra um item e escolha “Revelar”.'));
  } else if(view==='conexoes') {
    html=head('Conecte sua mesa','Uma conexão para as mensagens. Outra para dar som ao mundo.')+`<div class="two-cols"><div class="panel"><h2>Discord</h2><p class="muted">Para salvar e reconectar automaticamente, conecte pela engrenagem da barra lateral do aplicativo. A conexão abaixo é temporária e não é incluída nos backups.</p><form id="connect-form"><label>Token do bot<input name="token" type="password" autocomplete="off" required placeholder="Cole aqui, nunca no chat"></label><div class="actions"><button class="primary">Conectar e verificar</button><button type="button" data-action="disconnect">Desconectar</button></div><p class="form-error" role="alert"></p></form><ol><li>Crie uma aplicação no <a href="https://discord.com/developers/applications" target="_blank" rel="noopener">portal do Discord</a> e obtenha o token na aba Bot.</li><li>Instale o bot no servidor com Ver canais, Enviar mensagens, Inserir links, Anexar arquivos, Ler histórico e Enviar enquetes.</li><li>Ative o modo desenvolvedor no Discord, clique com o botão direito no canal de texto e copie o ID.</li></ol><p class="muted">A conexão de voz é feita pela engrenagem da barra lateral. Para entrar em voz, o bot também precisa das permissões Conectar e Falar.</p></div><div class="panel"><h2>Preferências da campanha</h2><form id="settings-form"><label>Nome da campanha<input name="campaign" required maxlength="200" value="${esc(state.settings.campaign)}"></label><label>Geral · enquetes e informações (ID)<input name="channel" value="${esc(state.settings.channel)}" placeholder="ID do canal" inputmode="numeric"></label><label>Ambientação · imagens e revelações (ID)<input name="ambience_channel" value="${esc(state.settings.ambience_channel || '')}" placeholder="ID do canal Ambientação" inputmode="numeric"></label><label>Porta do player integrado<input type="number" name="kenku_port" min="1024" max="65535" value="${state.settings.kenku_port}"></label><button class="primary">Salvar preferências</button><p class="form-error" role="alert"></p></form><hr><h3>Áudio integrado</h3><p class="muted">O player já está integrado. Abra a engrenagem na barra lateral, conecte o bot e selecione o canal de voz em Output. Use as abas YouTube e Spotify para abrir suas músicas.</p><button data-action="kenku-test">Verificar player integrado</button><p id="kenku-test-result" class="muted"></p></div></div>`;
  }
  $('#content').innerHTML=html;
  bindForms();
}
function updateCollection(){const kind={ambientacao:'imagem',outros:'imagem',biblioteca:'imagem',personagens:'personagem',audio:'musica',notas:'nota'}[view];const items=state.items.filter(i=>i.kind!=='pasta' && (view==='notas'?i.kind===kind:sectionOf(i)===view));$('#collection').innerHTML=view==='audio'?audioCollection(filtered(items)):collection(filtered(items),kind,'Nenhum item encontrado.','Adicione um item ou ajuste a busca.');}
function openFolderEditor(item){
 const form=$('#folder-form');form.reset();form.elements.id.value=item?.id||'';form.elements.title.value=item?.title||'';$('.form-error',form).textContent='';$('#folder-title').textContent=item?'Renomear pasta':'Nova pasta';$('#folder-dialog').showModal();
}
$('#folder-form').addEventListener('submit',e=>{e.preventDefault();submitForm(e.target,async()=>{
 const form=e.target,old=state.items.find(i=>i.id===form.elements.id.value);
 await api('items/save',{...(old||{kind:'pasta',section:view,folder_id:folderId}),title:form.elements.title.value});
 $('#folder-dialog').close();await refresh();toast('Pasta salva.');
});});
function folderNavigation(){
 if(view==='notas')return '';
 const current=state.items.find(i=>i.id===folderId);
 const folders=state.items.filter(i=>i.kind==='pasta'&&sectionOf(i)===view&&(i.folder_id||'')===folderId);
 return `<div class="toolbar"><button data-action="folder-open" data-id="${esc(current?.folder_id||'')}">↑ ${current?'Voltar':'Raiz'}</button><strong>${esc(current?.title||labels[view])}</strong><button data-action="folder-new">+ Nova pasta</button></div><div class="grid">${folders.map(f=>`<article class="panel"><h3>📁 ${esc(f.title)}</h3><div class="actions"><button data-action="folder-open" data-id="${esc(f.id)}">Abrir</button>${view==='audio'?`<button data-action="folder-play" data-id="${esc(f.id)}">▶ Tocar pasta</button>`:''}<button data-action="folder-rename" data-id="${esc(f.id)}">Renomear</button><button data-action="delete" data-id="${esc(f.id)}">Excluir</button></div></article>`).join('')}</div>`;
}
function folderOptions(){
 const form=$('#item-form'),section=form.elements.section.value;
 form.elements.folder_id.innerHTML='<option value="">Sem pasta</option>'+state.items.filter(i=>i.kind==='pasta'&&sectionOf(i)===section).map(i=>`<option value="${esc(i.id)}">${esc(i.title)}</option>`).join('');
}
function fieldsVisibility(){const kind=$('[name=kind]',$('#item-form')).value;$$('[data-for]',$('#editor')).forEach(e=>e.hidden=!e.dataset.for.split(' ').includes(kind));}
function edit(item=null,kind='imagem'){
  editing=item;const form=$('#item-form');form.reset();form.elements.id.value='';form.elements.file.value='';$('.form-error',form).textContent='';
  const data=item||{kind,section:['audio','personagens','ambientacao','outros'].includes(view)?view:'outros',folder_id:folderId};form.elements.section.value=data.section||sectionOf(data);folderOptions();for(const [k,v] of Object.entries(data)){const input=form.elements.namedItem(k);if(input&&typeof v==='string')input.value=v;}
  $('#editor-title').textContent=item?.id?'Editar '+names[item.kind]:'Novo item';$('#file-label').textContent=item?.file?'Arquivo atual guardado. Escolha outro apenas para substituí-lo.':'Uma cópia será guardada na biblioteca.';
  $('#scene-members').innerHTML=state.items.filter(i=>!['cena','nota','pasta'].includes(i.kind)).map(i=>`<label class="check"><input type="checkbox" name="members" value="${esc(i.id)}" ${item?.members?.includes(i.id)?'checked':''}>${esc(i.title)} <small>· ${names[i.kind]}</small></label>`).join('')||'<p class="muted">Crie personagens, imagens ou músicas antes de associá-los a uma cena.</p>';
  fieldsVisibility();$('#editor').showModal();
}
function embedPreview(item){return `<div class="embed"><strong>${esc(item.title)}</strong><p>${esc(item.description)}</p>${item.affiliation?`<b>Afiliação:</b> ${esc(item.affiliation)}`:''}${imageFile(item.file)?`<img src="${fileUrl(item.file)}" alt="${esc(item.title)}">`:item.file?'<small>Inclui arquivo anexado.</small>':''}<small>${esc(state.settings.campaign)}</small></div>`;}
function reveal(item){
  if(item.kind==='musica')return api('kenku',{action:item.kenku_type==='soundboard'?'effect':'play',id:item.kenku_id}).then(()=>{toast('Comando enviado ao Kenku.');return syncPlayer();});
  const form=$('#reveal-form');form.reset();form.elements.item_id.value=item.id;form.elements.channel.value=item.channel||state.settings.ambience_channel||state.settings.channel;$('.form-error',form).textContent='';
  const members=(item.members||[]).map(id=>state.items.find(i=>i.id===id)).filter(Boolean);
  $('#preview').innerHTML=embedPreview(item)+members.map(i=>i.kind==='musica'?`<div class="embed">♫ ${esc(i.title)} · ${i.kenku_id?'Áudio via Kenku':'Associe um ID do Kenku antes de disparar'}</div>`:embedPreview(i)).join('');$('#reveal-dialog').showModal();
}
function openPoll(){const form=$('#poll-form');form.reset();form.elements.channel.value=state.settings.channel;$('.form-error',form).textContent='';$('#poll-dialog').showModal();}
function openSession(){ $('#results-dialog').close();const form=$('#session-form');form.reset();form.elements.channel.value=state.settings.channel;$('.form-error',form).textContent='';$('#session-dialog').showModal();}
async function fileContent(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});}
async function submitForm(form,action){const button=$('button[type=submit],button:not([type])',form);if(button)button.disabled=true;$('.form-error',form).textContent='';try{await action();}catch(e){$('.form-error',form).textContent=e.message;}finally{if(button)button.disabled=false;}}
function due(form){const when=form.elements.when?.value;if(!when)return 0;const timestamp=new Date(when).getTime()/1000;if(!Number.isFinite(timestamp)||timestamp<=Date.now()/1000)throw new Error('Escolha um horário futuro.');return timestamp;}
function bindForms(){
  $('#settings-form')?.addEventListener('submit',e=>{e.preventDefault();submitForm(e.target,async()=>{await api('settings',Object.fromEntries(new FormData(e.target)));await refresh(false);toast('Preferências salvas.');});});
  $('#connect-form')?.addEventListener('submit',e=>{e.preventDefault();submitForm(e.target,async()=>{const result=await api('connect',{token:e.target.elements.token.value});e.target.elements.token.value='';await refresh(false);toast('Bot conectado: '+result.name);});});
  $('#search')?.addEventListener('input',e=>{filter=e.target.value;updateCollection();});$('#category')?.addEventListener('change',e=>{category=e.target.value;updateCollection();});
  $('#volume')?.addEventListener('change',async e=>{try{await api('kenku',{action:'volume',volume:Number(e.target.value)/100});toast('Volume ajustado.');}catch(err){toast(err.message);}});
}
$('#item-form').addEventListener('submit',e=>{e.preventDefault();submitForm(e.target,async()=>{
  const form=e.target,data=Object.fromEntries(new FormData(form));delete data.upload;data.members=$$('input[name=members]:checked',form).map(i=>i.value);
  const file=form.elements.upload.files[0];if(file){if(file.size>12000000)throw new Error('Escolha um arquivo de até 12 MB.');const uploaded=await api('upload',{name:file.name,content:await fileContent(file)});data.file=uploaded.file;}
  await api('items/save',data);$('#editor').close();await refresh();toast('Item salvo no seu acervo.');
});});
$('#item-form').elements.section.addEventListener('change',folderOptions);
$('#item-form').elements.kind.addEventListener('change',fieldsVisibility);
$('#reveal-form').addEventListener('submit',e=>{e.preventDefault();submitForm(e.target,async()=>{const data=Object.fromEntries(new FormData(e.target));data.due=due(e.target);if(!data.due&&!state.connected)throw new Error('Conecte o bot antes de disparar agora.');await api('jobs',data);$('#reveal-dialog').close();await refresh();toast(data.due?'Disparo agendado.':'Disparo colocado na fila. Acompanhe pela Agenda.');});});
$('#poll-form').addEventListener('submit',e=>{e.preventDefault();submitForm(e.target,async()=>{const data=Object.fromEntries(new FormData(e.target));data.type='poll';data.answers=data.answers.split('\n');data.weekly=e.target.elements.weekly.checked;data.due=due(e.target);if(!data.due&&!state.connected)throw new Error('Conecte o bot ou escolha um horário futuro.');await api('jobs',data);$('#poll-dialog').close();navigate('agenda');await refresh();toast('Enquete preparada na agenda.');});});
$('#session-form').addEventListener('submit',e=>{e.preventDefault();submitForm(e.target,async()=>{const data=Object.fromEntries(new FormData(e.target));data.when=due(e.target);data.reminders=e.target.elements.reminders.checked;const result=await api('session',data);$('#session-dialog').close();navigate('agenda');await refresh();toast('Confirmação preparada: '+result.ids.length+' mensagem(ns) na agenda.');});});
$$('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
$$('nav button').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.view)));$('#connection-status').addEventListener('click',()=>navigate('conexoes'));$('.brand').addEventListener('click',()=>navigate('mesa'));
document.addEventListener('click',async e=>{
  const button=e.target.closest('[data-action]');if(!button)return;const item=state.items.find(i=>i.id===button.dataset.id);button.disabled=true;
  try{
    switch(button.dataset.action){
      case 'folder-open':folderId=button.dataset.id;filter='';category='';render();break;
      case 'folder-new':openFolderEditor();break;
      case 'folder-rename':openFolderEditor(item);break;
      case 'folder-play':await api('kenku',{action:'folder',id:item.id});await syncPlayer();toast('Sequência da pasta iniciada.');break;
      case 'new':edit(null,button.dataset.kind);break;
      case 'new-audio':edit({kind:'musica',section:'audio',folder_id:folderId,kenku_type:button.dataset.type,title:''});break;
      case 'player-sync':await syncPlayer(true);break;
      case 'edit':edit(item);break;
      case 'delete':if(confirm(`Excluir “${item.title}” do acervo? Arquivos e disparos já preparados serão preservados.`)){await api('items/delete',{id:item.id});await refresh();toast('Item excluído.');}break;
      case 'reveal':await reveal(item);break;
      case 'poll':openPoll();break;
      case 'session':openSession();break;
      case 'disconnect':await api('disconnect',{});await refresh();toast('Bot desconectado.');break;
      case 'cancel-job':await api('jobs/cancel',{id:button.dataset.id});await refresh();toast('Disparo cancelado.');break;
      case 'kenku':await api('kenku',{action:button.dataset.command});await syncPlayer();break;
      case 'stop-effect':await api('kenku',{action:'stop_effect',id:item.kenku_id});toast('Efeito parado.');break;
      case 'kenku-test':{const result=await api('kenku',{action:'state'});$('#kenku-test-result').textContent='Kenku conectado. '+(result.playing?'Reproduzindo agora.':'Player pausado.');break;}
      case 'kenku-library':{const [music,sounds]=await Promise.all([api('kenku',{action:'library'}),api('kenku',{action:'sounds'})]);const entries=[...(music.playlists||[]).map(i=>({...i,type:'playlist'})),...(music.tracks||[]).map(i=>({...i,type:'playlist'})),...(sounds.sounds||[]).map(i=>({...i,type:'soundboard'}))];$('#kenku-library').innerHTML=entries.map(i=>`<div class="kenku-row"><span>${esc(i.title)}<small>${esc(i.id)}</small></span><button data-action="import-kenku" data-title="${esc(i.title)}" data-kenku-id="${esc(i.id)}" data-type="${i.type}">Adicionar ao acervo</button></div>`).join('')||'<p class="muted">Nenhuma faixa cadastrada no player do Kenku.</p>';$('#kenku-status').textContent='● Conectado';break;}
      case 'import-kenku':edit({kind:'musica',section:'audio',folder_id:folderId,title:button.dataset.title,kenku_id:button.dataset.kenkuId,kenku_type:button.dataset.type,category:button.dataset.type==='soundboard'?'Efeitos':'Ambientação'});break;
      case 'results':{const result=await api('poll/results',{id:button.dataset.id});const poll=result.poll;if(!poll)throw new Error('O Discord ainda não retornou a enquete.');const counts=poll.results?.answer_counts||[];$('#results').innerHTML=`<p>${esc(poll.question.text)}</p>`+poll.answers.map(a=>`<div class="job"><span>${esc(a.poll_media.text)}</span><strong>${poll.results ? (counts.find(c=>c.id===a.answer_id)?.count||0)+' votos' : 'Indisponível'}</strong></div>`).join('')+'<p class="muted">Os jogadores podem escolher várias opções. Confira os participantes no Discord antes de confirmar a sessão.</p>';$('#results-dialog').showModal();break;}
    }
  }catch(error){toast(error.message);}finally{button.disabled=false;}
});
refresh().catch(e=>{ $('#content').innerHTML='<div class="empty"><h2>Não foi possível abrir a mesa.</h2><p>'+esc(e.message)+'</p></div>'; });
$('#player-volume').addEventListener('input',e=>$('#volume-value').textContent=e.target.value+'%');
$('#player-volume').addEventListener('change',async e=>{try{await api('kenku',{action:'volume',volume:Number(e.target.value)/100});}catch(error){toast(error.message);}});
syncPlayer();
setInterval(()=>{if(!document.hidden)syncPlayer();},10000);
setInterval(async()=>{if(document.hidden||$$('dialog[open]').length)return;try{await refresh(view==='agenda');}catch{}},7000);
