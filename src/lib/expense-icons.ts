/** Set di icone per le categorie di spesa (path SVG 24×24, stroke).
 *  L'assegnazione icona→categoria vive in DATA_DIR/categories-meta.json. */

export const EXPENSE_ICONS: Record<string, string> = {
	cart: 'M4 5h2l2.2 10.5a1.5 1.5 0 0 0 1.5 1.2h7.6a1.5 1.5 0 0 0 1.5-1.2L20.5 8H7M10 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2M17 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2',
	food: 'M5 3v7a2 2 0 0 0 2 2v9M9 3v7a2 2 0 0 1-2 2M7 3v4M15 12a3 5 0 0 1 3-9h1v18M18 12h-3',
	car: 'M5 16l1.5-5.5A2 2 0 0 1 8.4 9h7.2a2 2 0 0 1 1.9 1.5L19 16M5 16h14M5 16v3M19 16v3M7.5 13h.01M16.5 13h.01M6 9l-1.5 1M18 9l1.5 1',
	home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-6h4v6',
	health: 'M12 21C7 17 3 13.5 3 9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 9 2.5c0 4-4 7.5-9 11.5M12 9v6M9 12h6',
	travel: 'M3 20h18M6 17l-2-9 2 .8L8.5 12l4-1.5L7 5l2-.7 8 4.7 3-1a1.6 1.6 0 0 1 1 3L6 17',
	transport: 'M5 4h14a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1M4 9h16M8 20l-1 1.5M16 20l1 1.5M8 13.5h.01M16 13.5h.01',
	salary: 'M3 8h18v10H3zM3 11a3 3 0 0 0 3-3M21 11a3 3 0 0 1-3-3M3 15a3 3 0 0 1 3 3M21 15a3 3 0 0 0-3 3M12 15a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
	bank: 'M3 9l9-5 9 5M4 9v9M20 9v9M3 18h18v2H3zM8 12v6M12 12v6M16 12v6',
	shopping: 'M6 8h12l-1 12a2 2 0 0 1-2 1.8H9A2 2 0 0 1 7 20zM9 8V6a3 3 0 0 1 6 0v2',
	web: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3c2.5 2.4 3.8 5.6 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.6-3.8-9S9.5 5.4 12 3',
	bill: 'M7 3h10v18l-1.7-1.2L13.6 21l-1.6-1.2L10.4 21l-1.7-1.2L7 21zM10 8h4M10 12h4',
	phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1M11 18h2',
	cash: 'M4 7h16v10H4zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5M7 10h.01M17 14h.01',
	invest: 'M4 19 10 12 14 15 20 6M20 6v5M20 6h-5',
	gift: 'M4 10h16v4H4zM5 14h14v7H5zM12 10v11M12 10C10 10 7.5 9.5 7.5 7.2 7.5 5.5 10 4.6 12 8c2-3.4 4.5-2.5 4.5-.8C16.5 9.5 14 10 12 10',
	smoke: 'M4 15h13v3H4zM19 15v3M21 15v3M17 6a3 3 0 0 1 3 3M14 4a5 5 0 0 1 5 5',
	digital: 'M3 5h18v12H3zM9 21h6M12 17v4',
	book: 'M5 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H5zM19 4h-6a0 0 0 0 0 0 0v16a2 2 0 0 1 2-2h4z',
	misc: 'M12 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2M12 18a1 1 0 1 0 0-2 1 1 0 0 0 0 2'
};

export const ICON_NAMES = Object.keys(EXPENSE_ICONS);

/** Colore deterministico dal nome categoria (fallback quando il meta non ne definisce uno). */
export function categoryColor(name: string): string {
	let h = 0;
	for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
	const palette = [
		'#3987e5', '#9085e9', '#0ca37f', '#c98500', '#e66767', '#5aa9e6', '#b06ad4',
		'#7fb069', '#d4818c', '#4fb3bf', '#c9a227', '#8a91d9'
	];
	return palette[h % palette.length];
}
