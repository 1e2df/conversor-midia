# Conversor de MÃ­dia

Converte links (YouTube, X, Instagram, TikTok e centenas de outros) em MP3 ou MP4.

- **Site:** https://1e2df.github.io/conversor-midia/ (pasta `docs/`, GitHub Pages)
- **Servidor:** `server.js`, roda no seu PC e faz o trabalho com yt-dlp + ffmpeg.
  Um tÃºnel Cloudflare (gratuito, sem conta) deixa o site acessar o servidor pela internet.

## Requisitos (Windows)

```
winget install yt-dlp.yt-dlp
winget install Cloudflare.cloudflared
```

E Node.js 18+.

## Uso

1. DÃª dois cliques em `iniciar.bat`.
2. A janela mostra o link do site jÃ¡ apontando para o seu PC, e a **senha**. O link abre sozinho no navegador.
3. Na primeira vez, digite a senha. O navegador lembra dela.

O endereÃ§o do tÃºnel muda toda vez que o servidor reinicia, entÃ£o use sempre o link novo
(tambÃ©m salvo em `link-atual.txt`). A senha fica em `config.json` e nÃ£o vai para o git.

Abrindo `http://localhost:3000` no prÃ³prio PC, nÃ£o Ã© pedida senha.

VariÃ¡veis opcionais: `PORT`, `SENHA`, `TUNNEL=0` (sem tÃºnel), `OPEN=0` (nÃ£o abrir o navegador), `PAGES_URL`.

Baixe apenas conteÃºdo que vocÃª tem direito de usar.
