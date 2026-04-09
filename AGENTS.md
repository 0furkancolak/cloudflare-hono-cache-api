## Learned User Preferences
- Kullanici tum yanitlarin Turkce olmasini istiyor.
- Kullanici terminal odakli orneklerde ciktilarin okunakli olmasini (ozellikle `curl` + JSON formatli) tercih ediyor.

## Learned Workspace Facts
- Proje `bun` ile calisan `Hono + Cloudflare Workers` tabanli bir route-cache ornegidir.
- Gelistirme portu `3497` olarak ayarlanmistir (`wrangler dev --port 3497`).
- Duman testi akisi `scripts/smoke-cache.sh` uzerindedir ve `make test` bu scripti calistirir.
- Cache invalidate endpoint'i, env tanimli degilse varsayilan olarak `change-production` degerini kullanir.
