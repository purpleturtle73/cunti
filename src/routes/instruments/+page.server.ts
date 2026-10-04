import { redirect } from '@sveltejs/kit';

// La gestione strumenti è stata spostata in Amministrazione → Transazioni
export const load = () => {
	redirect(301, '/admin/transazioni');
};
