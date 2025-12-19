export interface Metadata {
	generatedAt: string;
	logitThreshold: number;
	smoothingWindow: number;
	dateRange: {
		start: string;
		end: string;
	};
	nSpecies: number;
	nSites: number;
	nDays: number;
}

export interface TimeSeries {
	dates: string[];
	mean: number[];
	sites: Record<string, number[]>;
}

export interface Species {
	name: string;
	total: number;
	rank: number;
	timeSeries: TimeSeries;
}

export interface SpeciesData {
	metadata: Metadata;
	species: Species[];
}

export type ViewMode = 'all' | 'single';

export interface ChartConfig {
	showSiteLines: boolean;
	selectedSpecies: string | null;
	viewMode: ViewMode;
}

// Common bird names mapping
export const COMMON_NAMES: Record<string, string> = {
	'Troglodytes troglodytes': 'Wren',
	'Erithacus rubecula': 'Robin',
	'Turdus philomelos': 'Song Thrush',
	'Turdus merula': 'Blackbird',
	'Phylloscopus collybita': 'Chiffchaff',
	'Cyanistes caeruleus': 'Blue Tit',
	'Sylvia atricapilla': 'Blackcap',
	'Periparus ater': 'Coal Tit',
	'Strix aluco': 'Tawny Owl',
	'Sitta europaea': 'Nuthatch'
};

export function getSpeciesData(scientificName: string, birdData?: Record<string, {common_name: string, species_code: string}>): {common_name: string, species_code: string} | null {
	if (!birdData) return null;
	if (birdData[scientificName]) return birdData[scientificName];
	// Find keys that start with scientificName + ' '
	const candidates = Object.keys(birdData).filter(key => key.startsWith(scientificName + ' '));
	if (candidates.length > 0) {
		// Pick the first one alphabetically
		const key = candidates.sort()[0];
		return birdData[key];
	}
	return null;
}

export function getCommonName(scientificName: string, birdData?: Record<string, {common_name: string, species_code: string}>): string {
	const data = getSpeciesData(scientificName, birdData);
	if (data) return data.common_name.split(' (')[0];
	return COMMON_NAMES[scientificName] || scientificName;
}

export function getBaseName(name: string): string {
	return name.split(' ').slice(0, 2).join(' ');
}
