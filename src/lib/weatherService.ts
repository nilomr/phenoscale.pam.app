/**
 * Weather Service - Open-Meteo API Integration
 *
 * Fetches weather data from Open-Meteo's free API for the Wytham Woods site.
 * Used for adding temperature and precipitation context to detection timelines.
 *
 * API Docs: https://open-meteo.com/en/docs
 */

// Wytham Woods coordinates (Oxford, UK)
const SITE_LATITUDE = 51.771342;
const SITE_LONGITUDE = -1.337984;
const SITE_TIMEZONE = 'Europe/London';

const OPEN_METEO_ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

/**
 * Daily weather summary
 */
export interface DailyWeather {
	date: Date;
	temperatureMax: number; // °C
	temperatureMin: number; // °C
	temperatureMean: number; // °C
	precipitationSum: number; // mm
}

/**
 * Weather response containing daily data
 */
export interface WeatherData {
	latitude: number;
	longitude: number;
	timezone: string;
	daily: DailyWeather[];
}

/**
 * Open-Meteo API response types
 */
interface OpenMeteoDailyResponse {
	time: string[];
	temperature_2m_max: number[];
	temperature_2m_min: number[];
	temperature_2m_mean: number[];
	precipitation_sum: number[];
}

interface OpenMeteoResponse {
	latitude: number;
	longitude: number;
	timezone: string;
	daily?: OpenMeteoDailyResponse;
	error?: boolean;
	reason?: string;
}

/**
 * Simple in-memory cache for weather data
 */
const weatherCache = new Map<string, { data: WeatherData; timestamp: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour for historical data

function getCacheKey(startDate: string, endDate: string): string {
	return `${startDate}_${endDate}`;
}

/**
 * Fetch historical weather data
 */
export async function fetchHistoricalWeather(
	startDate: string, // YYYY-MM-DD
	endDate: string // YYYY-MM-DD
): Promise<WeatherData> {
	// Check cache
	const cacheKey = getCacheKey(startDate, endDate);
	const cached = weatherCache.get(cacheKey);
	if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
		return cached.data;
	}

	const params = new URLSearchParams({
		latitude: String(SITE_LATITUDE),
		longitude: String(SITE_LONGITUDE),
		timezone: SITE_TIMEZONE,
		start_date: startDate,
		end_date: endDate,
		daily: 'temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum'
	});

	const url = `${OPEN_METEO_ARCHIVE_URL}?${params}`;

	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(15000) // 15 second timeout
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const data: OpenMeteoResponse = await response.json();

		if (data.error) {
			throw new Error(`Open-Meteo API error: ${data.reason}`);
		}

		// Parse daily data
		const daily: DailyWeather[] = [];
		if (data.daily) {
			const d = data.daily;
			for (let i = 0; i < d.time.length; i++) {
				daily.push({
					date: new Date(d.time[i]),
					temperatureMax: d.temperature_2m_max[i],
					temperatureMin: d.temperature_2m_min[i],
					temperatureMean: d.temperature_2m_mean[i],
					precipitationSum: d.precipitation_sum[i]
				});
			}
		}

		const result: WeatherData = {
			latitude: data.latitude,
			longitude: data.longitude,
			timezone: data.timezone,
			daily
		};

		// Cache the result
		weatherCache.set(cacheKey, { data: result, timestamp: Date.now() });

		return result;
	} catch (err) {
		console.error('Failed to fetch weather data:', err);
		throw err;
	}
}

/**
 * Clear the weather cache
 */
export function clearWeatherCache(): void {
	weatherCache.clear();
}
