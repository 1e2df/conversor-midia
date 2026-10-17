# Conversor de Mídia

Converte links (YouTube, X, Instagram, TikTok e centenas de outros) em MP3 ou MP4.

- **Site:** https://1e2df.github.io/conversor-midia/ (pasta `docs/`, GitHub Pages)
- **Servidor:** `server.js`, roda no seu PC e faz o trabalho com yt-dlp + ffmpeg.
  Um túnel Cloudflare (gratuito, sem conta) deixa o site acessar o servidor pela internet.

## Requisitos (Windows)

```
winget install yt-dlp.yt-dlp
winget install Cloudflare.cloudflared
```

E Node.js 18+.

## Uso

1. Dê dois cliques em `iniciar.bat`.
2. A janela mostra o link do site já apontando para o seu PC, e a **senha**. O link abre sozinho no navegador.
3. Na primeira vez, digite a senha. O navegador lembra dela.

O endereço do túnel muda toda vez que o servidor reinicia, então use sempre o link novo
(também salvo em `link-atual.txt`). A senha fica em `config.json` e não vai para o git.

Abrindo `http://localhost:3000` no próprio PC, não é pedida senha.

Variáveis opcionais: `PORT`, `SENHA`, `TUNNEL=0` (sem túnel), `OPEN=0` (não abrir o navegador), `PAGES_URL`.

Baixe apenas conteúdo que você tem direito de usar.
