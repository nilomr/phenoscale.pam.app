/**
 * KDE Service - Kernel Density Estimation for Species Detection Distribution
 *
 * Provides 2D KDE calculations for visualizing spatial distribution of bird detections
 * across logger positions over time. Uses canvas-based heatmap rendering.
 */

import type { Species } from './types';

/**
 * Logger position with coordinates
 */
export interface LoggerPosition {
	name: string;
	latitude: number;
	longitude: number;
}

/**
 * Weekly detection data per logger
 */
export interface WeeklyDetectionData {
	weekStart: Date;
	weekEnd: Date;
	weekLabel: string;
	loggers: Map<string, number>; // logger name -> total detections for week
	totalDetections: number;
	maxLoggerDetections: number;
}

/**
 * Bounds for the map
 */
export interface MapBounds {
	minLat: number;
	maxLat: number;
	minLon: number;
	maxLon: number;
}

/**
 * Logger NDVI data structure (from ndviService)
 */
interface LoggerNdvi {
	latitude: number;
	longitude: number;
	timeseries: {
		dates: string[];
		flights: number[];
		ndvi_mean: number[];
		ndvi_std: number[];
		ndvi_min: number[];
		ndvi_max: number[];
	};
}

interface NdviData {
	metadata: {
		n_loggers: number;
		n_records: number;
		generated: string;
	};
	loggers: Record<string, LoggerNdvi>;
}

// Cache for logger positions
let loggerPositionsCache: Map<string, LoggerPosition> | null = null;

/**
 * Fetch logger positions from NDVI data file
 */
export async function fetchLoggerPositions(): Promise<Map<string, LoggerPosition>> {
	if (loggerPositionsCache) {
		return loggerPositionsCache;
	}

	try {
		const response = await fetch('/detections/logger_ndvi_timeseries_2025.json', {
			signal: AbortSignal.timeout(15000)
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const data: NdviData = await response.json();
		const positions = new Map<string, LoggerPosition>();

		for (const [name, logger] of Object.entries(data.loggers)) {
			positions.set(name, {
				name,
				latitude: logger.latitude,
				longitude: logger.longitude
			});
		}

		loggerPositionsCache = positions;
		return positions;
	} catch (err) {
		console.error('Failed to fetch logger positions:', err);
		throw err;
	}
}

/**
 * Get bounds from logger positions with padding
 */
export function getMapBounds(loggerPositions: Map<string, LoggerPosition>, padding: number = 0.12): MapBounds {
	const positions = Array.from(loggerPositions.values());
	const lats = positions.map(p => p.latitude);
	const lons = positions.map(p => p.longitude);

	const minLat = Math.min(...lats);
	const maxLat = Math.max(...lats);
	const minLon = Math.min(...lons);
	const maxLon = Math.max(...lons);

	const latPadding = (maxLat - minLat) * padding;
	const lonPadding = (maxLon - minLon) * padding;

	return {
		minLat: minLat - latPadding,
		maxLat: maxLat + latPadding,
		minLon: minLon - lonPadding,
		maxLon: maxLon + lonPadding
	};
}

/**
 * Get the start of the week (Monday) for a given date
 */
function getWeekStart(date: Date): Date {
	const d = new Date(date);
	const day = d.getUTCDay();
	const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
	d.setUTCDate(diff);
	d.setUTCHours(0, 0, 0, 0);
	return d;
}

/**
 * Format week label
 */
function formatWeekLabel(weekStart: Date): string {
	const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const day = weekStart.getUTCDate();
	const month = monthNames[weekStart.getUTCMonth()];
	return `${month} ${day}`;
}

/**
 * Aggregate species detections by week and logger
 */
export function aggregateByWeek(
	species: Species,
	loggerPositions: Map<string, LoggerPosition>
): WeeklyDetectionData[] {
	const weeklyMap = new Map<string, WeeklyDetectionData>();
	const dates = species.timeSeries.dates;
	const sites = species.timeSeries.sites;

	for (let i = 0; i < dates.length; i++) {
		const date = new Date(dates[i]);
		const weekStart = getWeekStart(date);
		const weekKey = weekStart.toISOString().slice(0, 10);

		if (!weeklyMap.has(weekKey)) {
			const weekEnd = new Date(weekStart);
			weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
			weeklyMap.set(weekKey, {
				weekStart,
				weekEnd,
				weekLabel: formatWeekLabel(weekStart),
				loggers: new Map(),
				totalDetections: 0,
				maxLoggerDetections: 0
			});
		}

		const weekData = weeklyMap.get(weekKey)!;

		for (const [loggerName, values] of Object.entries(sites)) {
			if (!loggerPositions.has(loggerName)) continue;

			const value = values[i] ?? 0;
			const current = weekData.loggers.get(loggerName) ?? 0;
			const newValue = current + value;
			weekData.loggers.set(loggerName, newValue);
			weekData.totalDetections += value;
			weekData.maxLoggerDetections = Math.max(weekData.maxLoggerDetections, newValue);
		}
	}

	return Array.from(weeklyMap.values()).sort(
		(a, b) => a.weekStart.getTime() - b.weekStart.getTime()
	);
}

/**
 * Render KDE heatmap to canvas using Gaussian kernel
 */
export function renderKDEToCanvas(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	weekData: WeeklyDetectionData,
	loggerPositions: Map<string, LoggerPosition>,
	bounds: MapBounds,
	colorFunc: (value: number) => string,
	bandwidth: number = 25 // pixels
): void {
	// Create offscreen canvas for density calculation
	const densityData = new Float32Array(width * height);
	let maxDensity = 0;

	// Convert logger positions to screen coordinates
	const loggerScreenPos: { x: number; y: number; weight: number }[] = [];
	
	for (const [loggerName, detections] of weekData.loggers) {
		if (detections === 0) continue;
		const pos = loggerPositions.get(loggerName);
		if (!pos) continue;

		const x = ((pos.longitude - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * width;
		const y = height - ((pos.latitude - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * height;
		
		// Normalize weight
		const weight = detections / (weekData.maxLoggerDetections || 1);
		loggerScreenPos.push({ x, y, weight });
	}

	// Calculate density at each pixel using Gaussian kernel
	const bw2 = bandwidth * bandwidth * 2;
	
	for (let py = 0; py < height; py++) {
		for (let px = 0; px < width; px++) {
			let density = 0;
			
			for (const logger of loggerScreenPos) {
				const dx = px - logger.x;
				const dy = py - logger.y;
				const distSq = dx * dx + dy * dy;
				
				// Gaussian kernel
				const kernel = Math.exp(-distSq / bw2);
				density += logger.weight * kernel;
			}
			
			densityData[py * width + px] = density;
			maxDensity = Math.max(maxDensity, density);
		}
	}

	// Normalize and render to canvas
	if (maxDensity > 0) {
		const imageData = ctx.createImageData(width, height);
		const data = imageData.data;

		for (let i = 0; i < densityData.length; i++) {
			const normalizedDensity = densityData[i] / maxDensity;
			const color = colorFunc(normalizedDensity);
			
			// Parse color (expects rgba or rgb format)
			const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
			if (match) {
				const idx = i * 4;
				data[idx] = parseInt(match[1]);
				data[idx + 1] = parseInt(match[2]);
				data[idx + 2] = parseInt(match[3]);
				data[idx + 3] = Math.round((parseFloat(match[4] ?? '1') * 255));
			}
		}

		ctx.putImageData(imageData, 0, 0);
	}
}

/**
 * Create a color function for the heatmap
 */
export function createHeatmapColorFunc(baseColor: string): (value: number) => string {
	// Parse the base color
	const tempCanvas = document.createElement('canvas');
	const tempCtx = tempCanvas.getContext('2d')!;
	tempCtx.fillStyle = baseColor;
	const computedColor = tempCtx.fillStyle;
	
	// Extract RGB from hex
	let r = 255, g = 200, b = 50;
	if (computedColor.startsWith('#')) {
		const hex = computedColor.slice(1);
		r = parseInt(hex.slice(0, 2), 16);
		g = parseInt(hex.slice(2, 4), 16);
		b = parseInt(hex.slice(4, 6), 16);
	}

	return (value: number): string => {
		if (value < 0.01) {
			return 'rgba(0, 0, 0, 0)';
		}
		
		// Smooth interpolation with power curve for better visual distinction
		const t = Math.pow(value, 0.7);
		const alpha = Math.min(0.85, t * 0.9);
		
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	};
}

/**
 * Clear caches
 */
export function clearKDECache(): void {
	loggerPositionsCache = null;
}
