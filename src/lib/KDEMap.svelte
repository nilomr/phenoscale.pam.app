<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as d3 from 'd3';
	import type { Species } from './types';
	import {
		getLoggerPositions,
		getSpeciesMapStats,
		getPerimeterCoordinates,
		type LoggerPosition
	} from './dataStore';

	interface Props {
		species: Species[];
		selectedSpecies: string | null;
		colorScale: d3.ScaleOrdinal<string, string>;
		birdData: Record<string, { common_name: string; species_code: string }> | null;
		imageMap: Record<string, string>;
		isMobile?: boolean;
		timelineBinDays?: number;
	}

	let {
		species,
		selectedSpecies,
		colorScale,
		birdData,
		imageMap,
		isMobile = false,
		timelineBinDays = 1
	}: Props = $props();

	// Constants
	const TIMELINE_HEIGHT = 56;
	const GLOW_SPRITE_SIZE = 128;

	// State
	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let mapContainerEl = $state<HTMLDivElement | null>(null);
	let containerEl = $state<HTMLDivElement | null>(null);
	let containerWidth = $state(800);
	let containerHeight = $state(450);
	let mapWidth = $state(400);
	let mapHeight = $state(350);
	let loading = $state(false);

	// Animation State
	let isPlaying = $state(false);
	let currentIndex = $state(0);
	let animationFrameId: number | null = null;
	let needsRedraw = $state(true);
	let lastFrameTime = 0;
	const FRAME_INTERVAL = 80;
	const PLAY_SPEED = 1.5;

	// Pre-rendered glow sprite cache
	let glowSpriteCache = new Map<string, HTMLCanvasElement>();

	// Perimeter data
	const perimeterCoordinates = getPerimeterCoordinates();

	// Data
	const loggerMap = getLoggerPositions();
	const loggers = Array.from(loggerMap.values());

	// Pre-compute bounds
	const geoBounds = (() => {
		if (loggers.length === 0) return { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 };

		const lats = loggers.map((l) => l.latitude);
		const lons = loggers.map((l) => l.longitude);
		const minLat = Math.min(...lats);
		const maxLat = Math.max(...lats);
		const minLon = Math.min(...lons);
		const maxLon = Math.max(...lons);

		const latPad = (maxLat - minLat) * 0.15;
		const lonPad = (maxLon - minLon) * 0.15;

		return {
			minLat: minLat - latPad,
			maxLat: maxLat + latPad,
			minLon: minLon - lonPad,
			maxLon: maxLon + lonPad
		};
	})();

	// Projection state
	let projectionParams = $state({ offsetX: 0, offsetY: 0, scale: 1 });
	let loggerScreenPositions = $state<Map<string, { x: number; y: number }>>(new Map());

	// Current species
	const currentSpecies = $derived(
		selectedSpecies ? species.find((s) => s.name === selectedSpecies) : species[0]
	);

	const dates = $derived(currentSpecies?.timeSeries.dates || []);
	const maxIndex = $derived(Math.max(0, dates.length - 1));

	// Timeline month labels
	const monthTicks = $derived.by(() => {
		if (dates.length === 0) return [];
		const dateObjs = dates.map((d) => new Date(d));
		const minDate = dateObjs[0];
		const maxDate = dateObjs[dateObjs.length - 1];
		return d3.utcMonth.range(minDate, maxDate);
	});

	const monthFormatter = d3.utcFormat('%b');

	// Pre-computed stats from data store
	const mapStats = $derived(currentSpecies ? getSpeciesMapStats(currentSpecies.name) : null);

	const globalMax = $derived(mapStats?.globalMax ?? 1);
	const dailyTotals = $derived(mapStats?.dailyTotals ?? []);
	const maxDailyTotal = $derived(mapStats?.maxDailyTotal ?? 1);
	const dailyTrends = $derived(mapStats?.dailyTrends ?? []);
	const dailyConcentration = $derived(mapStats?.dailyClustering ?? []);
	const activeSiteCounts = $derived(mapStats?.activeSiteCounts ?? []);
	const totalActiveSites = $derived(mapStats?.totalActiveSites ?? 0);
	const cumulativeTotal = $derived(mapStats?.cumulativeTotal ?? []);

	// Aggregated bins for timeline histogram
	const binnedTotals = $derived.by(() => {
		const size = Math.max(1, Math.floor(timelineBinDays));
		if (!dailyTotals || dailyTotals.length === 0) return [];
		const bins: number[] = [];
		for (let i = 0; i < dailyTotals.length; i += size) {
			let sum = 0;
			for (let j = 0; j < size && i + j < dailyTotals.length; j++) {
				sum += dailyTotals[i + j] || 0;
			}
			bins.push(sum);
		}
		return bins;
	});

	const binnedDates = $derived.by(() => {
		const size = Math.max(1, Math.floor(timelineBinDays));
		if (!dates || dates.length === 0) return [];
		const out: string[] = [];
		for (let i = 0; i < dates.length; i += size) {
			out.push(dates[i]);
		}
		return out;
	});

	const binnedMax = $derived.by(() => {
		const bins = binnedTotals;
		return bins.length ? Math.max(1, Math.max(...bins)) : 1;
	});

	// Create glow sprite
	function createGlowSprite(r: number, g: number, b: number): HTMLCanvasElement {
		const key = `${r},${g},${b}`;
		if (glowSpriteCache.has(key)) {
			return glowSpriteCache.get(key)!;
		}

		const size = GLOW_SPRITE_SIZE;
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d')!;

		const cx = size / 2;
		const cy = size / 2;
		const radius = size / 2;

		const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
		gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.7)`);
		gradient.addColorStop(0.15, `rgba(${r}, ${g}, ${b}, 0.5)`);
		gradient.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, 0.25)`);
		gradient.addColorStop(0.7, `rgba(${r}, ${g}, ${b}, 0.08)`);
		gradient.addColorStop(1, 'rgba(0,0,0,0)');

		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, size, size);

		glowSpriteCache.set(key, canvas);
		return canvas;
	}

	onMount(() => {
		updateProjection();
		startAnimationLoop();

		// Keyboard listener
		const handleKeydown = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

			if (e.code === 'Space') {
				e.preventDefault();
				togglePlay();
			} else if (e.code === 'ArrowLeft') {
				e.preventDefault();
				currentIndex = Math.max(0, currentIndex - 1);
				needsRedraw = true;
			} else if (e.code === 'ArrowRight') {
				e.preventDefault();
				currentIndex = Math.min(maxIndex, currentIndex + 1);
				needsRedraw = true;
			}
		};

		window.addEventListener('keydown', handleKeydown);
		return () => window.removeEventListener('keydown', handleKeydown);
	});

	// Container resize observer
	$effect(() => {
		if (!containerEl) return;
		const ro = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) {
				containerWidth = entry.contentRect.width;
				containerHeight = entry.contentRect.height;
				needsRedraw = true;
			}
		});
		ro.observe(containerEl);
		return () => ro.disconnect();
	});

	// Map container resize observer
	$effect(() => {
		if (!mapContainerEl) return;
		const ro = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) {
				mapWidth = entry.contentRect.width;
				mapHeight = entry.contentRect.height;
				updateProjection();
				needsRedraw = true;
			}
		});
		ro.observe(mapContainerEl);
		return () => ro.disconnect();
	});

	// Mark for redraw when species changes
	$effect(() => {
		if (currentSpecies) {
			needsRedraw = true;
		}
	});

	function updateProjection() {
		if (mapWidth <= 0 || mapHeight <= 0) return;

		const lonRange = geoBounds.maxLon - geoBounds.minLon;
		const latRange = geoBounds.maxLat - geoBounds.minLat;

		if (lonRange <= 0 || latRange <= 0) return;

		const centerLat = (geoBounds.minLat + geoBounds.maxLat) / 2;
		const latCorrectionFactor = Math.cos((centerLat * Math.PI) / 180);
		const effectiveLonRange = lonRange * latCorrectionFactor;

		const scaleX = mapWidth / effectiveLonRange;
		const scaleY = mapHeight / latRange;
		const scale = Math.min(scaleX, scaleY) * 1.1;

		const projectedWidth = effectiveLonRange * scale;
		const projectedHeight = latRange * scale;
		const offsetX = (mapWidth - projectedWidth) / 2;
		const offsetY = (mapHeight - projectedHeight) / 2;

		projectionParams = { offsetX, offsetY, scale };

		const positions = new Map<string, { x: number; y: number }>();
		for (const logger of loggers) {
			const x = offsetX + (logger.longitude - geoBounds.minLon) * latCorrectionFactor * scale;
			const y = offsetY + (geoBounds.maxLat - logger.latitude) * scale;
			positions.set(logger.name, { x, y });
		}
		loggerScreenPositions = positions;
	}

	function projectCoord(lon: number, lat: number): { x: number; y: number } {
		const centerLat = (geoBounds.minLat + geoBounds.maxLat) / 2;
		const latCorrectionFactor = Math.cos((centerLat * Math.PI) / 180);
		const x =
			projectionParams.offsetX +
			(lon - geoBounds.minLon) * latCorrectionFactor * projectionParams.scale;
		const y = projectionParams.offsetY + (geoBounds.maxLat - lat) * projectionParams.scale;
		return { x, y };
	}

	function drawPerimeter(ctx: CanvasRenderingContext2D) {
		if (!perimeterCoordinates || perimeterCoordinates.length === 0) return;

		ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
		ctx.lineWidth = 1.5;

		for (const ring of perimeterCoordinates) {
			if (ring.length < 2) continue;

			ctx.beginPath();
			const firstPoint = projectCoord(ring[0].lon, ring[0].lat);
			ctx.moveTo(firstPoint.x, firstPoint.y);

			for (let i = 1; i < ring.length; i++) {
				const point = projectCoord(ring[i].lon, ring[i].lat);
				ctx.lineTo(point.x, point.y);
			}

			ctx.closePath();
			ctx.stroke();
		}
	}

	function startAnimationLoop() {
		const loop = (timestamp: number) => {
			if (isPlaying) {
				if (timestamp - lastFrameTime >= FRAME_INTERVAL) {
					currentIndex += PLAY_SPEED;
					if (currentIndex >= maxIndex) {
						currentIndex = 0;
					}
					needsRedraw = true;
					lastFrameTime = timestamp;
				}
			}

			if (needsRedraw) {
				drawMap();
				needsRedraw = false;
			}

			animationFrameId = requestAnimationFrame(loop);
		};
		animationFrameId = requestAnimationFrame(loop);
	}

	onDestroy(() => {
		if (animationFrameId) cancelAnimationFrame(animationFrameId);
	});

	function drawMap() {
		if (!canvasEl || !currentSpecies || loggerScreenPositions.size === 0) return;
		const ctx = canvasEl.getContext('2d');
		if (!ctx) return;

		ctx.clearRect(0, 0, mapWidth, mapHeight);

		drawPerimeter(ctx);

		const sites = currentSpecies.timeSeries.sites;
		const idxFloor = Math.floor(currentIndex);
		const idxCeil = Math.min(idxFloor + 1, maxIndex);
		const t = currentIndex - idxFloor;

		const baseColor = d3.color(colorScale(currentSpecies.name)) || d3.color('#197569')!;
		const r = baseColor.rgb().r;
		const g = baseColor.rgb().g;
		const b = baseColor.rgb().b;

		const glowSprite = createGlowSprite(r, g, b);

		ctx.globalCompositeOperation = 'lighter';

		const baseRadius = Math.min(mapWidth, mapHeight) * 0.14;

		for (const logger of loggers) {
			const counts = sites[logger.name];
			if (!counts) continue;

			const count1 = counts[idxFloor] || 0;
			const count2 = counts[idxCeil] || 0;
			const count = count1 + (count2 - count1) * t;

			if (count < 0.5) continue;

			const pos = loggerScreenPositions.get(logger.name);
			if (!pos) continue;

			const normalized = count / globalMax;
			const intensity = Math.pow(normalized, 1);

			if (intensity < 0.02) continue;

			const size = baseRadius * (0.6 + intensity * 1.8);

			ctx.globalAlpha = 0.25 + intensity * 0.75;
			ctx.drawImage(glowSprite, pos.x - size, pos.y - size, size * 2, size * 2);
		}

		ctx.globalAlpha = 1;

		// Draw sensor points
		ctx.globalCompositeOperation = 'source-over';
		ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
		for (const logger of loggers) {
			const pos = loggerScreenPositions.get(logger.name);
			if (!pos) continue;
			ctx.beginPath();
			ctx.arc(pos.x, pos.y, 1.5, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	function handleTimelineClick(e: MouseEvent) {
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const ratio = Math.max(0, Math.min(1, x / rect.width));
		currentIndex = ratio * maxIndex;
		needsRedraw = true;
	}

	function handleTimelineDrag(e: MouseEvent) {
		if (e.buttons !== 1) return;
		handleTimelineClick(e);
	}

	function togglePlay() {
		isPlaying = !isPlaying;
	}

	function formatDate(idx: number): string {
		if (!dates.length) return '';
		const i = Math.min(Math.floor(idx), dates.length - 1);
		return new Date(dates[i]).toLocaleDateString(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
	}

	function getCurrentTotal(): number {
		const idx = Math.floor(currentIndex);
		return dailyTotals[idx] || 0;
	}

	function formatDetectionNumber(num: number): { leading: string; significant: string } {
		const maxVal = Math.max(globalMax, cumulativeTotal[cumulativeTotal.length - 1] || 0);
		const maxDigits = Math.ceil(Math.log10(Math.max(maxVal, 10)));
		const rounded = Math.round(num);
		const sigRaw = rounded.toString();
		const leadingZerosCount = Math.max(0, maxDigits - sigRaw.length);
		const padded = '0'.repeat(leadingZerosCount) + sigRaw;
		// Insert thousands separators into the padded string
		const formattedPadded = padded.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
		const formattedSignificant = rounded.toLocaleString();
		const significant = formattedPadded.slice(-formattedSignificant.length);
		const leading = formattedPadded.slice(0, formattedPadded.length - formattedSignificant.length);
		return { leading, significant };
	}

	function getCurrentTrend(): number {
		const idx = Math.floor(currentIndex);
		return dailyTrends[idx] || 0;
	}

	function getCurrentConcentration(): number {
		const idx = Math.floor(currentIndex);
		return dailyConcentration[idx] || 0;
	}

	function getCurrentActiveSites(): number {
		const idx = Math.floor(currentIndex);
		return activeSiteCounts[idx] || 0;
	}

	function getCumulativeTotal(): number {
		const idx = Math.floor(currentIndex);
		return cumulativeTotal[idx] || 0;
	}

	function getTrendColor(trend: number): string {
		const absTrend = Math.abs(trend);
		if (absTrend < 0.005) return 'rgba(255, 255, 255, 0.85)'; // White for near-zero
		
		if (trend > 0) {
			// Green gradient: white → light green → strong green
			const intensity = Math.min(1, absTrend / 0.3); // Reach full color at 30% change
			const r = Math.round(255 - (255 - 34) * intensity);
			const g = Math.round(255 - (255 - 197) * intensity);
			const b = Math.round(255 - (255 - 94) * intensity);
			return `rgb(${r}, ${g}, ${b})`;
		} else {
			// Red gradient: white → light red → strong red
			const intensity = Math.min(1, absTrend / 0.3); // Reach full color at 30% change
			const r = Math.round(255 - (255 - 239) * intensity);
			const g = Math.round(255 - (255 - 68) * intensity);
			const b = Math.round(255 - (255 - 68) * intensity);
			return `rgb(${r}, ${g}, ${b})`;
		}
	}

	const timelineProgress = $derived((currentIndex / maxIndex) * 100);

	const formattedCurrentTotal = $derived.by(() => formatDetectionNumber(getCurrentTotal()));
	const formattedSeasonTotal = $derived.by(() => formatDetectionNumber(getCumulativeTotal()));
</script>

<div class="kde-container" class:mobile={isMobile} bind:this={containerEl}>
	<div class="main-content">
		<!-- Map Panel -->
		<div class="map-panel">
			<div class="map-area" bind:this={mapContainerEl}>
				{#if loading}
					<div class="loading-overlay">
						<div class="spinner"></div>
					</div>
				{/if}

				<canvas bind:this={canvasEl} width={mapWidth} height={mapHeight} class="map-canvas"
				></canvas>

				<div class="map-info">
					<span class="info-text">{loggers.length} loggers in a 100m grid</span>
				</div>

				<div class="keyboard-hint">
					<span>Space</span> play/pause  <span>←→</span> navigate
				</div>
			</div>

			<!-- Timeline -->
			<div class="timeline-area">
				<button class="play-btn" onclick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
					{#if isPlaying}
						<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
							<rect x="6" y="4" width="4" height="16" rx="1" />
							<rect x="14" y="4" width="4" height="16" rx="1" />
						</svg>
					{:else}
						<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
							<path d="M8 5v14l11-7z" />
						</svg>
					{/if}
				</button>

				<div class="timeline-container">
					<div
						class="timeline-track"
						onclick={handleTimelineClick}
						onmousemove={handleTimelineDrag}
						role="slider"
						aria-label="Timeline"
						aria-valuemin={0}
						aria-valuemax={maxIndex}
						aria-valuenow={currentIndex}
						tabindex={0}
					>
						<svg class="sparkline" viewBox="0 0 100 20" preserveAspectRatio="none">
							{#each monthTicks as tick}
								{@const dateObjs = dates.map((d) => new Date(d))}
								{@const minDate = dateObjs[0]}
								{@const maxDate = dateObjs[dateObjs.length - 1]}
								{@const dateRange = maxDate.getTime() - minDate.getTime()}
								{@const tickPos = ((tick.getTime() - minDate.getTime()) / dateRange) * 100}
								<line
									x1={tickPos}
									y1="0"
									x2={tickPos}
									y2="20"
									stroke="rgba(255,255,255,0.06)"
									stroke-width="0.2"
								/>
							{/each}

							{#each binnedTotals as total, i}
								{@const slotWidth = 100 / Math.max(1, binnedTotals.length)}
								{@const gapFraction = 0.4}
								{@const barWidth = Math.max(0, slotWidth * (1 - gapFraction))}
								{@const sidePadding = (slotWidth - barWidth) / 2}
								{@const barHeight = (total / binnedMax) * 16}
								{@const x = i * slotWidth + sidePadding}
								{@const y = 20 - barHeight}
								<rect
									{x}
									{y}
									width={barWidth}
									height={barHeight}
									rx="1"
									fill={colorScale(currentSpecies?.name || '')}
									opacity="0.85"
								/>
							{/each}
						</svg>

						<div class="playhead" style="left: {timelineProgress}%"></div>
					</div>

					<div class="timeline-labels">
						{#each monthTicks as tick}
							{@const dateObjs = dates.map((d) => new Date(d))}
							{@const minDate = dateObjs[0]}
							{@const maxDate = dateObjs[dateObjs.length - 1]}
							{@const dateRange = maxDate.getTime() - minDate.getTime()}
							{@const tickPos = ((tick.getTime() - minDate.getTime()) / dateRange) * 100}
							<div class="month-marker" style="left: {tickPos}%">
								<span class="month-label">{monthFormatter(tick)}</span>
							</div>
						{/each}
					</div>
				</div>
			</div>
		</div>

		<!-- Stats Panel -->
		<div class="stats-panel">
			<div class="current-date">
				{formatDate(currentIndex)}
			</div>

			<div class="primary-stat">
				<div class="stat-value">
					<span class="leading-zeros">{formattedCurrentTotal.leading}</span>{formattedCurrentTotal.significant}
				</div>
				<div class="stat-label">detections</div>
			</div>

			<div class="stats-grid">
				<div class="stat-item">
					<div
						class="stat-icon"
						class:up={getCurrentTrend() > 0}
						class:down={getCurrentTrend() < 0}
					>
						{#if getCurrentTrend() > 0}
							↑
						{:else if getCurrentTrend() < 0}
							↓
						{:else}
							→
						{/if}
					</div>
					<div class="stat-content">
						<div class="stat-title">7-day trend</div>
						<div
							class="stat-data"
							style="color: {getTrendColor(getCurrentTrend())}"
						>
							{(getCurrentTrend() * 100).toFixed(1)}%
						</div>
					</div>
				</div>

				<div class="stat-item">
					<div class="stat-icon neutral">⊙</div>
					<div class="stat-content">
						<div class="stat-title">Activity Focus</div>
						<div class="concentration-bar">
							<div class="concentration-fill" style="width: {getCurrentConcentration() * 100}%"></div>
						</div>
					</div>
				</div>

				<div class="stat-item">
					<div class="stat-icon neutral">●</div>
					<div class="stat-content">
						<div class="stat-title">Active sites</div>
						<div class="stat-data">{getCurrentActiveSites()} / {totalActiveSites}</div>
					</div>
				</div>
			</div>

			<div class="season-total">
				<span class="season-label">Season total</span>
				<span class="season-value">
					<span class="leading-zeros">{formattedSeasonTotal.leading}</span>{formattedSeasonTotal.significant}
				</span>
			</div>
		</div>
	</div>
</div>

<style>
	.kde-container {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: #16171a;
		border-radius: 6px;
		overflow: hidden;
	}

	.main-content {
		flex: 1;
		display: flex;
		min-height: 0;
	}

	/* Map Panel */
	.map-panel {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.map-area {
		flex: 1;
		position: relative;
		min-height: 0;
		background: #1a1b1e;
	}

	.map-canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.loading-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10;
	}

	.spinner {
		width: 20px;
		height: 20px;
		border: 2px solid rgba(255, 255, 255, 0.1);
		border-top-color: rgba(255, 255, 255, 0.6);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.map-info {
		position: absolute;
		bottom: 10px;
		left: 14px;
		font-size: 10px;
		color: rgba(255, 255, 255, 0.3);
	}

	.keyboard-hint {
		position: absolute;
		bottom: 7px;
		right: 10px;
		font-size: 10px;
		color: rgba(255, 255, 255, 0.6);
		font-family: var(--font-sans);
		padding: 6px 10px;
		line-height: 1.4;
		font-weight: 300;
		letter-spacing: 0.01em;
	}

	.keyboard-hint span {
		font-weight: 400;
		color: rgba(255, 255, 255, 0.8);
		background: rgba(255, 255, 255, 0.1);
		border-radius: 3px;
		padding: 2px 4px;
		margin: 0 2px;
		font-size: 10px;
		letter-spacing: 0.02em;
	}

	/* Stats Panel */
	.stats-panel {
		width: 280px;
		flex-shrink: 0;
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		background: #1a1b1e;
		border-left: 1px solid rgba(255, 255, 255, 0.06);
	}

	.current-date {
		font-size: 13px;
		font-weight: 500;
		color: rgba(255, 255, 255, 0.9);
		padding-bottom: 16px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	}

	.primary-stat {
		text-align: center;
		padding: 16px 0;
	}

	.stat-value {
		font-size: 32px;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.95);
		font-variant-numeric: tabular-nums;
		line-height: 1;
		margin-bottom: 6px;
	}

	.stat-label {
		font-size: 11px;
		color: rgba(255, 255, 255, 0.4);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 500;
	}

	.stats-grid {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.stat-item {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.stat-icon {
		width: 32px;
		height: 32px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 16px;
		color: rgba(255, 255, 255, 0.5);
		background: rgba(255, 255, 255, 0.04);
		border-radius: 4px;
	}

	.stat-icon.up {
		color: #22c55e;
		background: rgba(34, 197, 94, 0.1);
	}

	.stat-icon.down {
		color: #ef4444;
		background: rgba(239, 68, 68, 0.1);
	}

	.stat-icon.neutral {
		color: rgba(255, 255, 255, 0.4);
	}

	.stat-content {
		flex: 1;
		min-width: 0;
	}

	.stat-title {
		font-size: 10px;
		color: rgba(255, 255, 255, 0.45);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 500;
		margin-bottom: 0px;
	}

	.stat-data {
		font-size: 14px;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.85);
		font-variant-numeric: tabular-nums;
	}

	.leading-zeros {
		opacity: 0.2;
	}

	.concentration-bar {
		width: 60px;
		height: 4px;
		background: rgba(255, 255, 255, 0.1);
		border-radius: 2px;
		overflow: hidden;
		margin-top: 4px;
	}

	.concentration-fill {
		height: 100%;
		background: rgba(255, 255, 255, 0.8);
		border-radius: 2px;
		transition: width 0.2s ease;
	}

	.season-total {
		margin-top: auto;
		padding-top: 18px;
		border-top: 1px solid rgba(255, 255, 255, 0.06);
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}

	.season-label {
		font-size: 10px;
		color: rgba(255, 255, 255, 0.45);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 500;
	}

	.season-value {
		font-size: 15px;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.85);
		font-variant-numeric: tabular-nums;
	}

	/* Timeline */
	.timeline-area {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px 16px;
		background: #1a1b1e;
		border-top: 1px solid rgba(255, 255, 255, 0.06);
	}

	.play-btn {
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.06);
		border: none;
		color: rgba(255, 255, 255, 0.8);
		cursor: pointer;
		transition: all 0.15s ease;
		flex-shrink: 0;
	}

	.play-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		color: rgba(255, 255, 255, 0.95);
	}

	.timeline-container {
		flex: 1;
		display: flex;
		flex-direction: column;
	}

	.timeline-track {
		height: 28px;
		position: relative;
		cursor: pointer;
		border-radius: 3px;
		background: rgba(255, 255, 255, 0.03);
		overflow: hidden;
	}

	.sparkline {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: rgba(255, 255, 255, 0.9);
		transform: translateX(-50%);
		pointer-events: none;
		box-shadow: 0 0 4px rgba(255, 255, 255, 0.3);
	}

	.timeline-labels {
		display: flex;
		justify-content: flex-start;
		position: relative;
		height: 18px;
	}

	.month-marker {
		position: absolute;
		transform: translateX(-50%);
	}

	.month-label {
		font-size: 10px;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.4);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	/* Mobile */
	.kde-container.mobile .main-content {
		flex-direction: column;
	}

	.kde-container.mobile .stats-panel {
		width: 100%;
		flex-direction: row;
		flex-wrap: wrap;
		padding: 14px;
		border-left: none;
		border-top: 1px solid rgba(255, 255, 255, 0.06);
	}

	.kde-container.mobile .current-date {
		width: 100%;
		padding-bottom: 10px;
		margin-bottom: 6px;
	}

	.kde-container.mobile .primary-stat {
		display: none;
	}

	.kde-container.mobile .stats-grid {
		flex-direction: row;
		width: 100%;
		gap: 8px;
	}

	.kde-container.mobile .stat-item {
		flex: 1;
		flex-direction: column;
		text-align: center;
		gap: 6px;
	}

	.kde-container.mobile .season-total {
		display: none;
	}

	.kde-container.mobile .keyboard-hint {
		display: none;
	}
</style>
