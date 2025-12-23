/**
 * Centralized Data Store - Preloads all data at app startup
 * 
 * This ensures instant switching between species and views with no loading delays.
 */

import type { SpeciesData, Species } from './types';
import type { NdviData, ProcessedNdviData } from './ndviService';
import { processNdviData } from './ndviService';
import type { WeatherData } from './weatherService';

// ============================================================================
// Types
// ============================================================================

export interface LoggerPosition {
	name: string;
	latitude: number;
	longitude: number;
}

/** Pre-computed stats for the density map visualization */
export interface SpeciesMapStats {
	globalMax: number;           // Maximum detection count across all sites and days
	dailyTotals: number[];       // Sum of detections across all sites for each day
	maxDailyTotal: number;       // Maximum of dailyTotals
	// Enhanced stats for side panel
	dailyTrends: number[];       // -1 to 1 normalized percentage change (7-day rolling window)
	dailyClustering: number[];   // 0-1 Gini coefficient measuring concentration of detections across sites
	cumulativeTotal: number[];   // Running cumulative detections
	activeSiteCounts: number[];  // Number of sites with detections per day
	totalActiveSites: number;    // Total unique sites with any detections
}

export interface LoadingProgress {
	stage: 'idle' | 'species' | 'loggers' | 'birds' | 'ndvi' | 'weather' | 'images' | 'processing' | 'complete' | 'error';
	message: string;
	progress: number; // 0-100
	error?: string;
}

export interface AppData {
	speciesData: SpeciesData | null;
	loggerPositions: Map<string, LoggerPosition>;
	birdData: Record<string, { common_name: string; species_code: string }> | null;
	ndviData: ProcessedNdviData | null;
	weatherData: WeatherData | null;
	imagesLoaded: boolean;
	/** Pre-computed map stats per species name */
	speciesMapStats: Map<string, SpeciesMapStats>;
	/** Study area perimeter coordinates (WGS84 lat/lon) */
	perimeterCoordinates: Array<{lat: number, lon: number}[]> | null;
}

// ============================================================================
// State
// ============================================================================

let loadingState: LoadingProgress = {
	stage: 'idle',
	message: 'Initializing...',
	progress: 0
};

let appData: AppData = {
	speciesData: null,
	loggerPositions: new Map(),
	birdData: null,
	ndviData: null,
	weatherData: null,
	imagesLoaded: false,
	speciesMapStats: new Map(),
	perimeterCoordinates: null
};

let loadPromise: Promise<AppData> | null = null;
let subscribers: Set<(state: LoadingProgress) => void> = new Set();
let dataSubscribers: Set<(data: AppData) => void> = new Set();

// ============================================================================
// Subscriber Management
// ============================================================================

export function subscribeToLoading(callback: (state: LoadingProgress) => void): () => void {
	subscribers.add(callback);
	callback(loadingState); // Immediate callback with current state
	return () => subscribers.delete(callback);
}

export function subscribeToData(callback: (data: AppData) => void): () => void {
	dataSubscribers.add(callback);
	if (loadingState.stage === 'complete') {
		callback(appData);
	}
	return () => dataSubscribers.delete(callback);
}

function notifyLoadingSubscribers() {
	subscribers.forEach(cb => cb(loadingState));
}

function notifyDataSubscribers() {
	dataSubscribers.forEach(cb => cb(appData));
}

function updateProgress(stage: LoadingProgress['stage'], message: string, progress: number, error?: string) {
	loadingState = { stage, message, progress, error };
	notifyLoadingSubscribers();
}

// ============================================================================
// Data Loading Functions
// ============================================================================

async function loadSpeciesData(): Promise<SpeciesData> {
	const response = await fetch('/detections/species_data.json');
	if (!response.ok) throw new Error('Failed to load species data');
	return response.json();
}

async function loadLoggerPositions(): Promise<Map<string, LoggerPosition>> {
	const response = await fetch('/detections/logger_ndvi_timeseries_2025.json');
	if (!response.ok) throw new Error('Failed to load logger positions');
	
	const data = await response.json();
	const positions = new Map<string, LoggerPosition>();
	
	for (const [name, logger] of Object.entries(data.loggers as Record<string, any>)) {
		positions.set(name, {
			name,
			latitude: logger.latitude,
			longitude: logger.longitude
		});
	}
	
	return positions;
}

async function loadPerimeterCoordinates(): Promise<Array<{lat: number, lon: number}[]> | null> {
	try {
		const shpResponse = await fetch('/detections/perimeter/perimeter.shp');
		const dbfResponse = await fetch('/detections/perimeter/perimeter.dbf');
		
		if (!shpResponse.ok || !dbfResponse.ok) {
			console.warn('Could not load perimeter files');
			return null;
		}
		
		const shpBuffer = await shpResponse.arrayBuffer();
		const dbfBuffer = await dbfResponse.arrayBuffer();
		
		// Use shapefile library to parse
		const shapefile = await import('shapefile');
		const featureCollection = await shapefile.read(shpBuffer, dbfBuffer) as any;
		const features = Array.isArray(featureCollection) ? featureCollection : featureCollection.features;
		
		// Extract coordinates from each feature
		const rings: Array<{lat: number, lon: number}[]> = [];
		
		// Import proj4 for coordinate transformation
		const proj4 = await import('proj4');
		
		// Define projections: British National Grid (EPSG:27700) to WGS84 (EPSG:4326)
		const bng = '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +datum=OSGB36 +units=m +no_defs';
		const wgs84 = '+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs';
		
		for (const feature of features) {
			if (feature.geometry?.coordinates) {
				const coords = feature.geometry.coordinates;
				
				// Handle different geometry types
				if (feature.geometry.type === 'Polygon') {
					// Each ring in the polygon
					const polygonCoords = coords as number[][][];
					for (const ring of polygonCoords) {
						const transformedRing = ring.map((coord: number[]) => {
							// Transform from BNG to WGS84
							const [lon, lat] = proj4.default(bng, wgs84, [coord[0], coord[1]]);
							return { lon, lat };
						});
						rings.push(transformedRing);
					}
				} else if (feature.geometry.type === 'MultiPolygon') {
					// Each polygon, each ring
					const multipolygonCoords = coords as number[][][][];
					for (const polygon of multipolygonCoords) {
						for (const ring of polygon) {
							const transformedRing = ring.map((coord: number[]) => {
								// Transform from BNG to WGS84
								const [lon, lat] = proj4.default(bng, wgs84, [coord[0], coord[1]]);
								return { lon, lat };
							});
							rings.push(transformedRing);
						}
					}
				}
			}
		}
		
		return rings;
	} catch (error) {
		console.warn('Error loading perimeter:', error);
		return null;
	}
}

async function loadBirdData(): Promise<Record<string, { common_name: string; species_code: string }>> {
	const response = await fetch('/bird_data.json');
	if (!response.ok) throw new Error('Failed to load bird data');
	return response.json();
}

async function loadNdviData(): Promise<ProcessedNdviData> {
	const response = await fetch('/detections/logger_ndvi_timeseries_2025.json');
	if (!response.ok) throw new Error('Failed to load NDVI data');
	const data: NdviData = await response.json();
	return processNdviData(data);
}

async function loadWeatherData(startDate: string, endDate: string): Promise<WeatherData | null> {
	try {
		const params = new URLSearchParams({
			latitude: '51.771342',
			longitude: '-1.337984',
			timezone: 'Europe/London',
			start_date: startDate,
			end_date: endDate,
			daily: 'temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum'
		});

		const response = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`, {
			signal: AbortSignal.timeout(10000)
		});

		if (!response.ok) return null;

		const data = await response.json();
		if (!data.daily) return null;

		const daily = data.daily.time.map((dateStr: string, i: number) => ({
			date: new Date(dateStr),
			temperatureMax: data.daily.temperature_2m_max[i],
			temperatureMin: data.daily.temperature_2m_min[i],
			temperatureMean: data.daily.temperature_2m_mean[i],
			precipitationSum: data.daily.precipitation_sum[i] || 0
		}));

		return {
			latitude: data.latitude,
			longitude: data.longitude,
			timezone: data.timezone,
			daily
		};
	} catch {
		// Weather data is optional, don't fail the whole load
		return null;
	}
}

async function preloadImages(imageMap: Record<string, string>): Promise<void> {
	const urls = Object.values(imageMap);
	
	await Promise.all(
		urls.map(url => 
			new Promise<void>((resolve) => {
				const img = new Image();
				img.onload = () => resolve();
				img.onerror = () => resolve(); // Don't fail on missing images
				img.src = url;
			})
		)
	);
}

/**
 * Pre-compute map visualization stats for all species
 * This avoids expensive calculations when switching species
 */
function precomputeMapStats(speciesData: SpeciesData): Map<string, SpeciesMapStats> {
	const statsMap = new Map<string, SpeciesMapStats>();
	
	for (const sp of speciesData.species) {
		const sites = sp.timeSeries.sites;
		const numDays = sp.timeSeries.dates.length;
		const siteNames = Object.keys(sites);
		const numSites = siteNames.length;
		
		let globalMax = 0;
		const dailyTotals: number[] = new Array(numDays).fill(0);
		const activeSiteCounts: number[] = new Array(numDays).fill(0);
		const dailySiteValues: number[][] = []; // For Gini coefficient calculation
		
		// Track which sites ever had detections
		const sitesWithDetections = new Set<string>();
		
		// Initialize daily site values array
		for (let i = 0; i < numDays; i++) {
			dailySiteValues[i] = [];
		}
		
		// Single pass through all data
		for (const site of siteNames) {
			const counts = sites[site];
			for (let i = 0; i < counts.length; i++) {
				const count = counts[i] || 0;
				if (count > globalMax) globalMax = count;
				dailyTotals[i] += count;
				dailySiteValues[i].push(count);
				if (count > 0) {
					activeSiteCounts[i]++;
					sitesWithDetections.add(site);
				}
			}
		}
		
		// Compute trends (7-day rolling window comparison) - store percentage change
		const dailyTrends: number[] = new Array(numDays).fill(0);
		const windowSize = 7;
		for (let i = windowSize; i < numDays; i++) {
			const prev = dailyTotals.slice(i - windowSize, i).reduce((a, b) => a + b, 0) / windowSize;
			const curr = dailyTotals[i];
			if (prev > 0) {
				// Store percentage change, capped at ±100% for display
				dailyTrends[i] = Math.max(-1, Math.min(1, (curr - prev) / prev));
			}
		}
		
		// Compute concentration using Gini coefficient (higher = more concentrated)
		// Gini measures inequality in the distribution of detections across sites
		const dailyClustering: number[] = new Array(numDays).fill(0);
		for (let i = 0; i < numDays; i++) {
			const values = dailySiteValues[i];
			const totalDetections = dailyTotals[i];
			
			if (totalDetections > 0) {
				// Sort values in ascending order
				const sorted = [...values].sort((a, b) => a - b);
				const n = sorted.length;
				
				// Gini coefficient calculation
				let numerator = 0;
				for (let j = 0; j < n; j++) {
					numerator += (j + 1) * sorted[j];
				}
				const gini = (2 * numerator) / (n * totalDetections) - (n + 1) / n;
				
				// Ensure non-negative (can be slightly negative due to floating point)
				dailyClustering[i] = Math.max(0, gini);
			}
		}
		
		// Cumulative totals
		const cumulativeTotal: number[] = new Array(numDays).fill(0);
		let runningSum = 0;
		for (let i = 0; i < numDays; i++) {
			runningSum += dailyTotals[i];
			cumulativeTotal[i] = runningSum;
		}
		
		const maxDailyTotal = Math.max(...dailyTotals, 1);
		
		statsMap.set(sp.name, {
			globalMax: globalMax || 1,
			dailyTotals,
			maxDailyTotal,
			dailyTrends,
			dailyClustering,
			cumulativeTotal,
			activeSiteCounts,
			totalActiveSites: sitesWithDetections.size
		});
	}
	
	return statsMap;
}

// ============================================================================
// Main Load Function
// ============================================================================

export async function loadAllData(imageMap: Record<string, string>): Promise<AppData> {
	// Return existing promise if already loading
	if (loadPromise) return loadPromise;

	loadPromise = (async () => {
		try {
			// Stage 1: Species data (biggest file, most critical)
			updateProgress('species', 'Loading detection data...', 10);
			appData.speciesData = await loadSpeciesData();
			
			// Stage 2: Logger positions (needed for map)
			updateProgress('loggers', 'Loading sensor network...', 30);
			appData.loggerPositions = await loadLoggerPositions();
			
			// Stage 2.5: Study area perimeter
			updateProgress('loggers', 'Loading study area boundary...', 35);
			appData.perimeterCoordinates = await loadPerimeterCoordinates();
			
			// Stage 3: Bird metadata
			updateProgress('birds', 'Loading species info...', 45);
			appData.birdData = await loadBirdData();
			
			// Stage 4: NDVI data (already fetched with loggers, just process)
			updateProgress('ndvi', 'Processing vegetation data...', 55);
			appData.ndviData = await loadNdviData();
			
			// Stage 5: Pre-compute map stats for all species
			updateProgress('processing', 'Pre-computing visualizations...', 65);
			if (appData.speciesData) {
				appData.speciesMapStats = precomputeMapStats(appData.speciesData);
			}
			
			// Stage 6: Weather data (optional, don't block on failure)
			updateProgress('weather', 'Fetching weather history...', 80);
			if (appData.speciesData?.metadata?.dateRange) {
				appData.weatherData = await loadWeatherData(
					appData.speciesData.metadata.dateRange.start,
					appData.speciesData.metadata.dateRange.end
				);
			}
			
			// Stage 7: Preload images
			updateProgress('images', 'Loading illustrations...', 92);
			await preloadImages(imageMap);
			appData.imagesLoaded = true;
			
			// Complete!
			updateProgress('complete', 'Ready', 100);
			notifyDataSubscribers();
			
			return appData;
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			updateProgress('error', 'Failed to load data', 0, message);
			throw err;
		}
	})();

	return loadPromise;
}

// ============================================================================
// Synchronous Getters (for components that need data after load)
// ============================================================================

export function getSpeciesData(): SpeciesData | null {
	return appData.speciesData;
}

export function getLoggerPositions(): Map<string, LoggerPosition> {
	return appData.loggerPositions;
}

export function getBirdData(): Record<string, { common_name: string; species_code: string }> | null {
	return appData.birdData;
}

export function getNdviData(): ProcessedNdviData | null {
	return appData.ndviData;
}

export function getWeatherData(): WeatherData | null {
	return appData.weatherData;
}

export function getSpeciesMapStats(speciesName: string): SpeciesMapStats | null {
	return appData.speciesMapStats.get(speciesName) || null;
}

export function getPerimeterCoordinates(): Array<{lat: number, lon: number}[]> | null {
	return appData.perimeterCoordinates;
}

export function isLoaded(): boolean {
	return loadingState.stage === 'complete';
}

export function getLoadingState(): LoadingProgress {
	return loadingState;
}
