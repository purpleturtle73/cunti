/**
 * Vecchi indirizzi (segnalibri, link salvati): Spese è diventata Finanze, Dashboard e
 * Transazioni si sono unite in Investimenti, la gestione strumenti sta in Admin. La home
 * porta alla prima voce del menu (307: potrebbe tornare a essere una pagina).
 */
const LEGACY: [string, string][] = [
	['/admin/transazioni', '/admin/investimenti'],
	['/admin/spese', '/admin/finanze'],
	['/transactions', '/investimenti'],
	['/instruments', '/admin/investimenti'],
	['/spese', '/finanze']
];

export function redirectTarget(pathname: string): { location: string; status: 301 | 307 } | null {
	if (pathname === '/') return { location: '/finanze', status: 307 };
	for (const [from, to] of LEGACY)
		if (pathname === from || pathname.startsWith(from + '/'))
			return { location: to + pathname.slice(from.length), status: 301 };
	return null;
}
