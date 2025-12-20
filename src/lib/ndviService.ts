/**
 * NDVI Service - Logger NDVI Data
 *
 * Loads and processes NDVI timeseries data from all loggers.
 * Used for adding vegetation phenology context to detection timelines.
 */

// Cutoff date for NDVI data (exclude data after this)
const NDVI_CUTOFF_DATE = new Date('2025-06-13');

/**
 * Individual logger NDVI timeseries
 */
export interface LoggerNdvi {
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

/**
 * NDVI data file structure
 */
export interface NdviData {
	metadata: {
		n_loggers: number;
		n_records: number;
		generated: string;
	};
	loggers: Record<string, LoggerNdvi>;
}

/**
 * Daily NDVI summary across all loggers
 */
export interface DailyNdvi {
	date: Date;
	mean: number;
	std: number;
	min: number;
	max: number;
	loggerCount: number;
}

/**
 * Processed NDVI data for visualization
 */
export interface ProcessedNdviData {
	daily: DailyNdvi[];
	loggers: Map<string, { dates: Date[]; ndvi: number[] }>;
	dateRange: { start: Date; end: Date } | null;
}

// Cache for NDVI data
let ndviCache: NdviData | null = null;
let processedCache: ProcessedNdviData | null = null;

/**
 * Apply a simple moving average smoothing to reduce noise
 */
function smoothData(values: number[], windowSize: number = 3): number[] {
	if (values.length < windowSize) return values;
	
	const result: number[] = [];
	const halfWindow = Math.floor(windowSize / 2);
	
	for (let i = 0; i < values.length; i++) {
		let sum = 0;
		let count = 0;
		
		for (let j = Math.max(0, i - halfWindow); j <= Math.min(values.length - 1, i + halfWindow); j++) {
			// Use median-like weighting to reduce outlier impact
			sum += values[j];
			count++;
		}
		
		result.push(sum / count);
	}
	
	return result;
}

/**
 * Apply a robust smoothing that handles outliers better
 */
function robustSmooth(dates: Date[], values: number[], windowSize: number = 5): number[] {
	if (values.length < 3) return values;
	
	// First pass: identify and replace outliers with interpolated values
	const cleaned = [...values];
	for (let i = 1; i < values.length - 1; i++) {
		const prev = values[i - 1];
		const curr = values[i];
		const next = values[i + 1];
		const expected = (prev + next) / 2;
		const diff = Math.abs(curr - expected);
		
		// If value deviates more than 0.15 from neighbors average, replace it
		if (diff > 0.15) {
			cleaned[i] = expected;
		}
	}
	
	// Second pass: apply smoothing
	return smoothData(cleaned, windowSize);
}

/**
 * Fetch NDVI data from JSON file
 */
export async function fetchNdviData(): Promise<NdviData> {
	if (ndviCache) {
		return ndviCache;
	}

	try {
		const response = await fetch('/detections/logger_ndvi_timeseries_2025.json', {
			signal: AbortSignal.timeout(15000)
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const data: NdviData = await response.json();
		ndviCache = data;
		return data;
	} catch (err) {
		console.error('Failed to fetch NDVI data:', err);
		throw err;
	}
}

/**
 * Process raw NDVI data into daily summaries and per-logger series
 */
export function processNdviData(data: NdviData): ProcessedNdviData {
	if (processedCache) {
		return processedCache;
	}

	// Aggregate by date across all loggers
	const dailyMap = new Map<string, { values: number[]; stds: number[]; mins: number[]; maxs: number[] }>();
	const loggers = new Map<string, { dates: Date[]; ndvi: number[] }>();

	let minDate: Date | null = null;
	let maxDate: Date | null = null;

	for (const [loggerName, logger] of Object.entries(data.loggers)) {
		const dates: Date[] = [];
		const ndvi: number[] = [];

		for (let i = 0; i < logger.timeseries.dates.length; i++) {
			const dateStr = logger.timeseries.dates[i];
			const date = new Date(dateStr);
			
			// Skip data after cutoff date
			if (date > NDVI_CUTOFF_DATE) continue;
			
			const mean = logger.timeseries.ndvi_mean[i];

			if (mean != null && !isNaN(mean) && mean > 0.3) { // Filter out very low values (likely errors)
				dates.push(date);
				ndvi.push(mean);

				// Track date range
				if (!minDate || date < minDate) minDate = date;
				if (!maxDate || date > maxDate) maxDate = date;

				// Aggregate for daily summary
				if (!dailyMap.has(dateStr)) {
					dailyMap.set(dateStr, { values: [], stds: [], mins: [], maxs: [] });
				}
				const entry = dailyMap.get(dateStr)!;
				entry.values.push(mean);
			}
		}

		if (dates.length > 2) {
			// Apply robust smoothing to reduce noise
			const smoothedNdvi = robustSmooth(dates, ndvi, 3);
			loggers.set(loggerName, { dates, ndvi: smoothedNdvi });
		}
	}

	// Convert daily map to sorted array
	const daily: DailyNdvi[] = Array.from(dailyMap.entries())
		.map(([dateStr, entry]) => {
			const mean = entry.values.reduce((a, b) => a + b, 0) / entry.values.length;
			return {
				date: new Date(dateStr),
				mean,
				std: 0,
				min: mean,
				max: mean,
				loggerCount: entry.values.length
			};
		})
		.sort((a, b) => a.date.getTime() - b.date.getTime());

	processedCache = { 
		daily, 
		loggers,
		dateRange: minDate && maxDate ? { start: minDate, end: maxDate } : null
	};
	return processedCache;
}

/**
 * Get NDVI data filtered to a date range
 */
export function filterNdviByDateRange(
	data: ProcessedNdviData,
	startDate: Date,
	endDate: Date
): ProcessedNdviData {
	const daily = data.daily.filter(d => d.date >= startDate && d.date <= endDate);

	const loggers = new Map<string, { dates: Date[]; ndvi: number[] }>();
	for (const [name, logger] of data.loggers) {
		const filteredDates: Date[] = [];
		const filteredNdvi: number[] = [];

		for (let i = 0; i < logger.dates.length; i++) {
			if (logger.dates[i] >= startDate && logger.dates[i] <= endDate) {
				filteredDates.push(logger.dates[i]);
				filteredNdvi.push(logger.ndvi[i]);
			}
		}

		if (filteredDates.length > 0) {
			loggers.set(name, { dates: filteredDates, ndvi: filteredNdvi });
		}
	}

	return { 
		daily, 
		loggers,
		dateRange: daily.length > 0 
			? { start: startDate, end: endDate }
			: null
	};
}

/**
 * Clear the NDVI cache
 */
export function clearNdviCache(): void {
	ndviCache = null;
	processedCache = null;
}
