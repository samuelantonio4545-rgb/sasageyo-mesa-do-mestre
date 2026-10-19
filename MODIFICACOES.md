# Modificações em relação ao Kenku FM

Base: Kenku FM 1.5.5, Owlbear Rodeo, revisão dd534f1; https://github.com/owlbear-rodeo/kenku-fm. Derivado independente GPL-3.0, não oficial.

- Campanha local Python/SQLite com personagens, imagens, notas, enquetes, agenda e backups.
- Integração do serviço de campanha ao ciclo de vida do Electron e ao bot do Discord.
- Player local e captura de áudio; atualizador oficial desativado para preservar o derivado.
- Dados no Discord com motor Rollem v1 MIT e limites de trabalho.
- Versão 1.7: pastas/subpastas, sequência de músicas e persistência protegida do token via Electron safeStorage. O token é excluído da persistência Redux e dos backups da campanha.
- Cópia pública: preferências iniciais genéricas, sem IDs dos canais nem dados de campanha.

Ver README.md para compilação, testes, requisitos e limitações. Os créditos e licenças originais são preservados.
