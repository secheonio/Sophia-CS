#!/bin/sh
# 매일 새벽 DB를 백업한다. /etc/cron.d/sophia-cs-backup 에서 호출한다.
set -eu
cd /opt/sophia-cs
DATABASE_FILE=/var/lib/sophia-cs/app.db /usr/bin/node server/backup.js /var/backups/sophia-cs 30
