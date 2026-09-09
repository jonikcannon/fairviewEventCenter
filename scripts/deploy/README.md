Fairview VPS Deployment Kit

This folder includes a low-cost single-VPS deployment setup for this project.

Files
- bootstrap-vps.sh: one-time server bootstrap and app setup
- deploy.sh: repeatable deploy script for updates
- nginx.fairview.conf: Nginx site template used by bootstrap
- ecosystem.config.cjs: PM2 process config

Quick start
1) Push this repository to GitHub.
2) Provision an Ubuntu VPS.
3) Copy repo to server, then run:
   sudo bash scripts/deploy/bootstrap-vps.sh fairview-event-center.com git@github.com:jonikcannon/fairviewEventCenter.git hello@fairview-event-center.com
4) Edit /var/www/fairview/app/.env with real secrets.
5) Restart API:
   pm2 restart fairviewApi

Deploy updates
- On server:
  bash /var/www/fairview/app/scripts/deploy/deploy.sh

Notes
- This app writes uploads, inquiries, and gallery edits to persistent paths under /var/www/fairview/data.
- Gallery media comes from the Cloudflare R2 bucket when MEDIA_CDN_URL is set: Nginx
  redirects /assets/gallery/ there, and `npm run manifest` builds the gallery listing
  by listing the bucket. The VPS therefore needs no copy of the photos at all --
  upload from your workstation with `npm run media:sync`, then redeploy (or run
  `node scripts/generate-gallery-manifest.js` on the server) to refresh the manifest.
- Without MEDIA_CDN_URL, media is served off /var/www/fairview/data/storage/media/<category>/
  by Nginx and the manifest is built from that directory. It is not in git and not
  produced by the build, so a deploy never touches it; upload with rsync/scp instead.
- Older layouts (data/gallery, or media inside src/assets/gallery) are migrated
  automatically by bootstrap-vps.sh; the old data/gallery is renamed to
  data/gallery.migrated rather than deleted.
- Production setup reuses the root .env.example template.
- Ensure DNS A record for root and www point to the VPS before TLS step.
- If your default branch is not main, edit deploy.sh accordingly.

Helpful commands
- Generate JWT secret:
   openssl rand -hex 48
- Generate admin password hash:
   node -e "console.log(require('bcryptjs').hashSync('choose-a-strong-password', 12))"
