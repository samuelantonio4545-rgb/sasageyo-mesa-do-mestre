# Sasageyo — Mesa do Mestre

Aplicativo de Windows para organizar campanhas de RPG, controlar áudio e conectar um bot do Discord. Projeto independente de código aberto, baseado no Kenku FM 1.5.5.

## Recursos

- Personagens, imagens de ambientação e outros materiais, com pastas e subpastas.
- Trilhas sonoras organizadas em pastas: tocar a sequência ou escolher uma faixa.
- Enquetes para combinar sessões, lembretes e revelações programadas.
- Rolagens no chat: `d20`, `2d6+3`, `2d20kh1`, `6#4d6kh3`, usando o motor v1 do Rollem.
- Conexão do Discord salva com criptografia do Windows pela engrenagem do aplicativo.
- Player integrado e abas para YouTube e Spotify.

## Configurar o Discord

Crie seu próprio bot no [Discord Developer Portal](https://discord.com/developers/applications). Instale-o no servidor com Ver canais, Enviar mensagens, Inserir links, Anexar arquivos, Ler histórico e Enviar enquetes. Para áudio, conceda Conectar e Falar. Para dados no chat, ative Message Content Intent na aba Bot e ligue Dados no chat no aplicativo.

Informe o token somente no aplicativo. Pela engrenagem, Conectar e salvar lembra a conexão neste computador; Desconectar e esquecer remove a credencial salva. Cadastre os IDs dos canais nas preferências da campanha. Não publique tokens, arquivos `.env`, backups ou dados privados.

## Desenvolvimento no Windows x64

Requisitos: Node.js 22.12 ou superior, npm e Git. A distribuição embutida oficial do Python 3.13.7 está em `python/`, com sua licença. O arquivo `electron-source.tgz` fornece o pacote instalador do Electron da castLabs usado nesta versão.

```powershell
npm install --legacy-peer-deps
npm run compile
npm start
```

Execute os comandos na raiz do repositório. A instalação baixa o runtime do Electron da castLabs. O aplicativo se baseia no Electron 37.6.0+wvcus.

Testes (Python 3.11+ instalado para a suíte da campanha):

```powershell
python -m unittest discover -s campaign/tests
node --test dice.test.cjs
```

Para gerar a versão portátil, execute `npm run package`; a pasta `out/MesaDoMestre` deve estar ausente. O instalador usa Inno Setup 6 e `installer.iss`, com `PayloadDir` apontando para a versão portátil e `InstallerOutput` para o destino. Distribua também o código-fonte correspondente e as licenças.

## Limitações

O bot e os agendamentos dependem do programa aberto e conectado; publicar o código no GitHub não hospeda o bot 24 horas. Rode uma única instância de dados por token. A fila de pastas utiliza faixas/playlists cadastradas no player: links de YouTube/Spotify abrem nas abas próprias. Spotify depende dos requisitos de DRM/Widevine do serviço. A conexão pelo formulário da campanha é temporária; a persistência protegida está na engrenagem do desktop. O canal de voz é selecionado manualmente.

Esta versão não reproduz todos os recursos administrativos do Rollem. A reprodução real no Discord e Spotify não foi validada de ponta a ponta. Instaladores locais não são assinados digitalmente.

## Licenças e créditos

Projeto derivado sob **GPL-3.0**, conforme [LICENSE](LICENSE). Base: [Kenku FM](https://github.com/owlbear-rodeo/kenku-fm), da Owlbear Rodeo, revisão `dd534f1`. Não é uma versão oficial nem endossada pela Owlbear Rodeo.

O motor de dados `@rollem/language` 2.11.3 usa MIT, preservada em `src/main/dice/vendor/LICENSE`. Veja `ORIGEM.md` nessa pasta. Python e demais dependências mantêm suas próprias licenças. Consulte [MODIFICACOES.md](MODIFICACOES.md) e [ATUALIZACAO-1.7.md](ATUALIZACAO-1.7.md).
