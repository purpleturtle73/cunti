#!/bin/sh
# Avvio container: se non esiste un DB in DATA_DIR genera dati demo,
# altrimenti usa il DB esistente senza toccarlo.
# Disattivabile con SEED_DEMO=0 (parte con DB vuoto).
set -e

DB="${DATA_DIR:-/data}/cunti.db"

if [ ! -f "$DB" ]; then
	if [ "${SEED_DEMO:-1}" = "1" ]; then
		echo "Nessun DB in ${DB}: genero dati demo."
		node scripts/seed-demo.js
	else
		echo "Nessun DB in ${DB}: parto con DB vuoto (SEED_DEMO=0)."
	fi
else
	echo "DB esistente in ${DB}: nessun seed."
fi

exec node build/index.js
