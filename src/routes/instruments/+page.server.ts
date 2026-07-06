import { redirect } from '@sveltejs/kit';

// La gestione strumenti è stata spostata nel pannello Amministrazione
export const load = () => {
	redirect(301, '/admin');
};
