<script lang="ts">
	import * as d3 from 'd3';
	import type { Species } from './types';
	import { getCommonName, getSpeciesData } from './types';
	import { tick } from 'svelte';
	import { tweened } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import { fetchHistoricalWeather, type DailyWeather } from './weatherService';
	import { fetchNdviData, processNdviData, type ProcessedNdviData } from './ndviService';
import { fade } from 'svelte/transition';

	interface Props {
		species: Species[];
		selectedSpecies: string | null;
		showSiteLines: boolean;
		colorScale: d3.ScaleOrdinal<string, string>;
		birdData: Record<string, {common_name: string, species_code: string}> | null;
		imageMap: Record<string, string>;
		showTemperature?: boolean;
		showPrecipitation?: boolean;
		showNdvi?: boolean;
		dateRange?: { start: string; end: string };
		isMobile?: boolean;
	}

	let { 
		species, 
		selectedSpecies, 
		showSiteLines, 
		colorScale, 
		birdData, 
		imageMap,
		showTemperature = false,
		showPrecipitation = false,
		showNdvi = false,
		dateRange,
		isMobile = false
	}: Props = $props();

	// Chart dimensions
	const PADDING = { top: 60, right: 0, bottom: isMobile ? 20 : 50, left: 60 };
	let containerWidth = $state(800);
	let containerHeight = $state(450);

	const width = $derived(Math.max(200, containerWidth - PADDING.left - PADDING.right));
	const height = $derived(Math.max(150, containerHeight - PADDING.top - PADDING.bottom));

	// Container element for resize observer
	let containerEl = $state<HTMLDivElement | null>(null);

	// Tooltip state
	let tooltip = $state({ show: false, x: 0, y: 0, species: '', value: 0, imageSrc: null as string | null });

	// Weather data state
	let weatherData = $state<DailyWeather[]>([]);
	let weatherLoading = $state(false);

	// NDVI data state
	let ndviData = $state<ProcessedNdviData | null>(null);
	let ndviLoading = $state(false);

	// Fetch weather data when date range changes
	$effect(() => {
		if (!dateRange?.start || !dateRange?.end) return;
		
		weatherLoading = true;
		fetchHistoricalWeather(dateRange.start, dateRange.end)
			.then(data => {
				weatherData = data.daily;
			})
			.catch(err => {
				console.warn('Failed to fetch weather data:', err);
				weatherData = [];
			})
			.finally(() => {
				weatherLoading = false;
			});
	});

	// Fetch NDVI data on mount
	$effect(() => {
		ndviLoading = true;
		fetchNdviData()
			.then(data => {
				ndviData = processNdviData(data);
			})
			.catch(err => {
				console.warn('Failed to fetch NDVI data:', err);
				ndviData = null;
			})
			.finally(() => {
				ndviLoading = false;
			});
	});

	// Filter species to display
	const displaySpecies = $derived(
		selectedSpecies ? species.filter((s) => s.name === selectedSpecies) : species
	);

	// Svelte action to draw an SVG path using its exact length (prevents truncated/incorrect draws)
	function draw(node: SVGPathElement, params: { delay?: number; duration?: number; finalOpacity?: number } = {}) {
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		const start = ({ delay = 0, duration = 800, finalOpacity = 0.12 } = {}) => {
			try {
				const len = node.getTotalLength();
				node.style.strokeDasharray = `${len}`;
				node.style.strokeDashoffset = `${len}`;
				node.style.opacity = '0';
				// Force layout so transitions run predictably
				node.getBoundingClientRect();
				timeoutId = setTimeout(() => {
					node.style.transition = `stroke-dashoffset ${duration}ms cubic-bezier(0.2,0.65,0.2,1), opacity 300ms ease-out`;
					node.style.strokeDashoffset = '0';
					node.style.opacity = String(finalOpacity);
				}, delay);
			} catch (e) {
				// If path length is unavailable, just fade it in
				node.style.opacity = String(params.finalOpacity ?? 0.12);
			}
		};

		start(params);

		return {
			update(newParams: { delay?: number; duration?: number; finalOpacity?: number }) {
				if (timeoutId) clearTimeout(timeoutId);
				start(newParams);
			},
			destroy() {
				if (timeoutId) clearTimeout(timeoutId);
				node.style.transition = '';
				node.style.strokeDasharray = '';
				node.style.strokeDashoffset = '';
			}
		};
	}

	// Get all dates from first species
	const dates = $derived(species[0]?.timeSeries.dates.map((d) => new Date(d)) ?? []);

	// Scales
	const xScale = $derived(
		d3.scaleUtc()
			.domain(d3.extent(dates) as [Date, Date])
			.range([0, width])
	);

	// Build data for stacking (when showing all species)
	const stackedData = $derived.by(() => {
		if (selectedSpecies || species.length === 0 || dates.length === 0) return null;
		
		// Create data array for d3.stack
		const data = dates.map((date, i) => {
			const entry: Record<string, number | Date> = { date };
			for (const sp of species) {
				entry[sp.name] = sp.timeSeries.mean[i] ?? 0;
			}
			return entry;
		});

		const keys = species.map(s => s.name);
		const stackGenerator = d3.stack<Record<string, number | Date>>()
			.keys(keys)
			.offset(d3.stackOffsetSilhouette)
			.order(d3.stackOrderDescending);

		return stackGenerator(data as Iterable<Record<string, number>>);
	});

	// Y scale - different for stacked vs single
	const yScale = $derived.by(() => {
		if (stackedData) {
			const allValues = stackedData.flatMap(series => 
				series.flatMap(d => [d[0], d[1]])
			);
			const [minY, maxY] = d3.extent(allValues) as [number, number];
			const padding = Math.abs(maxY - minY) * 0.05;
			return d3.scaleLinear()
				.domain([minY - padding, maxY + padding])
				.range([height, 0]);
		} else {
			// Single species mode
			let max = 0;
			for (const sp of displaySpecies) {
				const meanMax = d3.max(sp.timeSeries.mean) ?? 0;
				max = Math.max(max, meanMax);
				if (showSiteLines) {
					for (const siteData of Object.values(sp.timeSeries.sites)) {
						const siteMax = d3.max(siteData) ?? 0;
						max = Math.max(max, siteMax);
					}
				}
			}
			return d3.scaleLinear()
				.domain([0, max * 1.1])
				.range([height, 0])
				.nice();
		}
	});

	// Area generator for stacked chart
	const areaGenerator = $derived(
		d3.area<d3.SeriesPoint<Record<string, number>>>()
			.x((d, i) => xScale(dates[i]))
			.y0(d => yScale(d[0]))
			.y1(d => yScale(d[1]))
			.curve(d3.curveBasis)
	);

	// Line generator for single species
	const lineGenerator = $derived(
		d3.line<number>()
			.x((_, i) => xScale(dates[i]))
			.y(d => yScale(d))
			.curve(d3.curveMonotoneX)
	);

	// Weather data mapped to dates
	const weatherByDate = $derived.by(() => {
		const map = new Map<string, DailyWeather>();
		for (const w of weatherData) {
			const key = w.date.toISOString().slice(0, 10);
			map.set(key, w);
		}
		return map;
	});

	// Temperature scale (secondary Y axis on right)
	const tempDomain = $derived.by(() => {
		if (weatherData.length === 0) return { min: 0, max: 30 };
		const temps = weatherData.flatMap(w => [w.temperatureMin, w.temperatureMax]);
		const minT = d3.min(temps) ?? 0;
		const maxT = d3.max(temps) ?? 30;
		const padding = (maxT - minT) * 0.1;
		return { min: minT - padding, max: maxT + padding };
	});

	const tempScale = $derived(
		d3.scaleLinear()
			.domain([tempDomain.min, tempDomain.max])
			.range([height, 0])
	);

	const tempColorScale = $derived(
		d3.scaleSequential(
			d3.interpolateRgbBasis([
				'#d73027', // deep red
				'#f46d43',
				'#fdae61',
				'#fee090',
				'#d9d9a3', // muted yellow (less bright)
				'#e0f3f8',
				'#abd9e9',
				'#74add1',
				'#4575b4'  // deep blue
			])
		)
			.domain([tempDomain.max, tempDomain.min]) // Reversed so red is max
	);

	const tempGradientStops = $derived.by(() => {
		const n = 10;
		const stops = [];
		for (let i = 0; i <= n; i++) {
			const t = i / n;
			const temp = tempDomain.min + t * (tempDomain.max - tempDomain.min);
			stops.push({
				offset: `${t * 100}%`,
				color: tempColorScale(temp)
			});
		}
		return stops;
	});

	// Precipitation scale
	const precipMax = $derived(d3.max(weatherData, w => w.precipitationSum) ?? 10);
	const precipScale = $derived(
		d3.scaleLinear()
			.domain([0, Math.max(precipMax, 1)])
			.range([height, height * 0.5]) // Precipitation bars from bottom, max height 50%
	);

	// Temperature line generator
	const tempLineGenerator = $derived(
		d3.line<[Date, number]>()
			.x(d => xScale(d[0]))
			.y(d => tempScale(d[1]))
			.curve(d3.curveMonotoneX)
			.defined(d => d[1] != null)
	);

	// Temperature area generator (for min/max range)
	const tempAreaGenerator = $derived(
		d3.area<[Date, number, number]>()
			.x(d => xScale(d[0]))
			.y0(d => tempScale(d[1])) // min
			.y1(d => tempScale(d[2])) // max
			.curve(d3.curveMonotoneX)
			.defined(d => d[1] != null && d[2] != null)
	);

	// Temperature data points
	const tempData = $derived.by(() => {
		return dates
			.map(date => {
				const key = date.toISOString().slice(0, 10);
				const w = weatherByDate.get(key);
				return w ? [date, w.temperatureMean] as [Date, number] : null;
			})
			.filter((d): d is [Date, number] => d !== null);
	});

	// Temperature area data (min/max)
	const tempAreaData = $derived.by(() => {
		return dates
			.map(date => {
				const key = date.toISOString().slice(0, 10);
				const w = weatherByDate.get(key);
				return w ? [date, w.temperatureMin, w.temperatureMax] as [Date, number, number] : null;
			})
			.filter((d): d is [Date, number, number] => d !== null);
	});

	// Precipitation bar data
	const precipData = $derived.by(() => {
		return dates
			.map((date, i) => {
				const key = date.toISOString().slice(0, 10);
				const w = weatherByDate.get(key);
				return w ? { date, precipitation: w.precipitationSum, x: xScale(date) } : null;
			})
			.filter((d): d is { date: Date; precipitation: number; x: number } => d !== null);
	});

	// Temperature path
	const tempPath = $derived(tempData.length > 0 ? tempLineGenerator(tempData) : null);
	
	// Temperature area path
	const tempAreaPath = $derived(tempAreaData.length > 0 ? tempAreaGenerator(tempAreaData) : null);

	// NDVI scale (0-1 range mapped to right Y axis)
	const ndviScale = $derived(
		d3.scaleLinear()
			.domain([0.4, 1]) // NDVI typically ranges from ~0.5 to ~0.95 for vegetation
			.range([height, 0])
	);

	// NDVI color scale (brown to green)
	const ndviColorScale = $derived(
		d3.scaleSequential(
			d3.interpolateRgbBasis([
				'#8B7355', // brown
				'#A8B06D', // olive
				'#6B8E23', // olive drab
				'#228B22', // forest green
				'#22C55E'  // bright green
			])
		)
			.domain([0.5, 0.95])
	);

	// NDVI line generator - use curveBasis for smoother lines
	const ndviLineGenerator = $derived(
		d3.line<[Date, number]>()
			.x(d => xScale(d[0]))
			.y(d => ndviScale(d[1]))
			.curve(d3.curveBasis)
			.defined(d => d[1] != null)
	);

	// Per-logger NDVI line data
	const ndviLoggerLines = $derived.by(() => {
		if (!ndviData) return [];
		const lines: { name: string; data: [Date, number][] }[] = [];
		for (const [name, logger] of ndviData.loggers) {
			const data: [Date, number][] = [];
			for (let i = 0; i < logger.dates.length; i++) {
				data.push([logger.dates[i], logger.ndvi[i]]);
			}
			if (data.length > 0) {
				lines.push({ name, data });
			}
		}
		return lines;
	});

	// NDVI date range for gradient fade
	const ndviDateRange = $derived.by(() => {
		if (!ndviData?.dateRange) return null;
		return {
			startX: xScale(ndviData.dateRange.start),
			endX: xScale(ndviData.dateRange.end)
		};
	});

	// Stream paths for stacked view
	const streamPaths = $derived.by(() => {
		if (!stackedData) return [];
		return stackedData.map(series => ({
			name: series.key,
			path: areaGenerator(series as unknown as d3.SeriesPoint<Record<string, number>>[]) ?? '',
			color: colorScale(series.key)
		}));
	});

	// Month ticks
	const monthTicks = $derived.by(() => {
		if (dates.length === 0) return [];
		const domain = d3.extent(dates) as [Date, Date];
		return d3.utcMonth.range(domain[0], domain[1]);
	});

	const monthFormatter = d3.utcFormat('%b');
	const yTicks = $derived(yScale.ticks(5));

	// Tooltip handlers
	function showTooltip(event: MouseEvent, speciesName: string) {
		const rect = containerEl?.getBoundingClientRect();
		if (!rect || !stackedData) return;

		const mouseX = event.clientX - rect.left - PADDING.left;
		const mouseY = event.clientY - rect.top - PADDING.top;

		// Find the date index
		const date = xScale.invert(mouseX);
		const bisect = d3.bisector((d: Date) => d).left;
		const index = bisect(dates, date, 1);
		const i = Math.max(0, Math.min(index - 1, dates.length - 1));

		// Find the series
		const series = stackedData.find(s => s.key === speciesName);
		if (!series) return;

		const point = series[i];
		const value = point[1] - point[0]; // height of the layer

		const speciesData = getSpeciesData(speciesName, birdData ?? undefined);
		const speciesCode = speciesData?.species_code;
		const imageSrc = speciesCode ? imageMap[speciesCode] : null;

		tooltip = {
			show: true,
			x: event.clientX - rect.left,
			y: event.clientY - rect.top,
			species: speciesName,
			value: Math.round(value),
			imageSrc
		};
	}

	function hideTooltip() {
		tooltip.show = false;
	}

	// Resize observer
	$effect(() => {
		if (!containerEl) return;
		const ro = new ResizeObserver(async (entries) => {
			const entry = entries[0];
			if (entry) {
				const rect = entry.contentRect;
				if (rect.width > 0 && rect.height > 0) {
					containerWidth = rect.width;
					containerHeight = rect.height;
				}
				await tick();
			}
		});
		ro.observe(containerEl);
		return () => ro.disconnect();
	});
</script>

<div class="chart-container" bind:this={containerEl}>
	<svg 
		class="chart-svg"
		viewBox="0 0 {containerWidth + 60} {containerHeight}"
		preserveAspectRatio="xMidYMid meet"
	>
		<defs>
			<!-- Organic glow filter -->
			<filter id="stream-glow" x="-50%" y="-50%" width="200%" height="200%">
				<feGaussianBlur stdDeviation="2" result="blur"/>
				<feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.4 0"/>
				<feMerge>
					<feMergeNode/>
					<feMergeNode in="SourceGraphic"/>
				</feMerge>
			</filter>
			
			<!-- Grid fade gradient -->
			<linearGradient id="grid-fade" x1="0" x2="0" y1="0" y2="1">
				<stop offset="0%" stop-color="white" stop-opacity="1"/>
				<stop offset="70%" stop-color="white" stop-opacity="0.5"/>
				<stop offset="100%" stop-color="white" stop-opacity="0"/>
			</linearGradient>
			<mask id="grid-mask">
				<rect x="0" y="0" width={width} height={height} fill="url(#grid-fade)"/>
			</mask>

			<!-- Temperature gradient -->
			<linearGradient id="temp-gradient" x1="0" x2="0" y1="1" y2="0">
				{#each tempGradientStops as stop}
					<stop offset={stop.offset} stop-color={stop.color} />
				{/each}
			</linearGradient>

			<!-- NDVI horizontal fade gradient (fade in at start, fade out at end) -->
			{#if ndviDateRange}
				{@const fadeWidth = 80}
				<linearGradient id="ndvi-fade" x1="0" x2="1" y1="0" y2="0">
					<stop offset="0%" stop-color="white" stop-opacity="0"/>
					<stop offset="{Math.min(20, fadeWidth / (ndviDateRange.endX - ndviDateRange.startX) * 100)}%" stop-color="white" stop-opacity="1"/>
					<stop offset="{Math.max(80, 100 - fadeWidth / (ndviDateRange.endX - ndviDateRange.startX) * 100)}%" stop-color="white" stop-opacity="1"/>
					<stop offset="100%" stop-color="white" stop-opacity="0"/>
				</linearGradient>
				<mask id="ndvi-mask">
					<rect 
						x={ndviDateRange.startX - 10} 
						y="0" 
						width={ndviDateRange.endX - ndviDateRange.startX + 20} 
						height={height} 
						fill="url(#ndvi-fade)"
					/>
				</mask>
			{/if}
		</defs>
		
		<g transform="translate({PADDING.left}, {PADDING.top})">
			<!-- Grid lines -->
			<g class="grid" mask="url(#grid-mask)">
				{#each monthTicks as tick}
					<line 
						x1={xScale(tick)} 
						x2={xScale(tick)} 
						y1="0" 
						y2={height}
						stroke="rgba(255,255,255,0.15)"
						stroke-dasharray="4 4"
					/>
				{/each}
			</g>

			<!-- Baseline at y=0 -->
			<line
				x1="0"
				x2={width}
				y1={yScale(0)}
				y2={yScale(0)}
				stroke="rgba(255,255,255,0.3)"
				stroke-width="1"
			/>
			
			<!-- Month labels at top -->
			<g class="month-labels">
				{#each monthTicks as tick}
					<text
						x={xScale(tick)}
						y="-24"
						text-anchor="middle"
						class="month-label"
					>
						{monthFormatter(tick)}
					</text>
				{/each}
			</g>

			<!-- Stacked stream view (all species) -->
			<g class="stacked-view" style="opacity: {!selectedSpecies ? 1 : 0}; transition: opacity 0.5s ease-out;">
				{#if !selectedSpecies && streamPaths.length > 0}
					{#each streamPaths as stream (stream.name)}
						<path
							d={stream.path}
							fill={stream.color}
							stroke={stream.color}
							stroke-width="0.5"
							filter="url(#stream-glow)"
							class="stream-path animated-path"
							opacity="0.85"
							role="img"
							aria-label={stream.name}
							onmouseenter={(e) => showTooltip(e, stream.name)}
							onmousemove={(e) => showTooltip(e, stream.name)}
							onmouseleave={hideTooltip}
						/>
					{/each}
				{/if}
			</g>

			<!-- Single species view -->
			<g class="single-view" style="opacity: {selectedSpecies ? 1 : 0}; transition: opacity 0.5s ease-out;">
				{#if selectedSpecies}
					{@const sp = displaySpecies[0]}
					{#if sp}
						<!-- Precipitation bars (background layer) -->
						{#if showPrecipitation && precipData.length > 0}
							<g class="precipitation-layer" transition:fade={{ duration: 200 }}>
								{#each precipData as bar}
									{@const barWidth = Math.max(2, width / dates.length * 0.6)}
									<rect
										x={bar.x - barWidth / 2}
										y={precipScale(bar.precipitation)}
										width={barWidth}
										height={height - precipScale(bar.precipitation)}
										fill="rgba(96, 165, 250, 0.3)"
										class="precip-bar"
										transition:fade={{ duration: 180 }}
									/>
								{/each}
							</g>
						{/if}

						<!-- Temperature area (min/max range) -->
						{#if tempAreaPath}
							<path
								d={tempAreaPath}
								fill="rgba(200, 200, 200, 0.1)"
								opacity={showTemperature ? 0.35 : 0}
								class="temp-area animated-path"
							/>
						{/if}

						<!-- Temperature line -->
						{#if showTemperature && tempPath}
							<path
								d={tempPath}
								fill="none"
								stroke={isMobile ? "#ff6b35" : "url(#temp-gradient)"}
								stroke-width="2"
								opacity="0.6"
								class="temp-line"
							/>
						{/if}

						<!-- NDVI logger lines with fade effect -->
						{#if showNdvi && ndviLoggerLines.length > 0 && ndviDateRange}
							<g class="ndvi-logger-lines" mask="url(#ndvi-mask)" transition:fade={{ duration: 200 }}>
								{#each ndviLoggerLines as logger, i (logger.name)}
									{@const pathD = ndviLineGenerator(logger.data)}
									{#if pathD && !pathD.includes('NaN')}
										<path
											d={pathD}
											fill="none"
											stroke="rgba(34, 197, 94, 0.7)"
											stroke-width="1.2"
											opacity="0.25"
											class="ndvi-logger-line animated-line"
										/>
									{/if}
								{/each}
							</g>
						{/if}

						<!-- Site lines (background) -->
						{#if showSiteLines}
							{@const siteEntries = Object.entries(sp.timeSeries.sites)}
							{#key sp.name}
								{#each siteEntries as [siteId, siteData], i (siteId)}
									{@const pathD = lineGenerator(siteData)}
									{#if pathD && !pathD.includes('NaN')}
										<path
											d={pathD}
											fill="none"
											stroke={colorScale(sp.name)}
											stroke-width="1"
											opacity="0.12"
											class="site-line animated-line"
											use:draw={{ delay: i * 20, duration: 400, finalOpacity: 0.12 }}
										/>
									{/if}
								{/each}
							{/key}
						{/if}
						
						<!-- Mean line -->
						<path
							d={lineGenerator(sp.timeSeries.mean) ?? ''}
							fill="none"
							stroke={colorScale(sp.name)}
							stroke-width="3"
							filter="url(#stream-glow)"
							class="mean-line animated-line"
						/>
					{/if}
				{/if}

				<!-- Y axis (only in single species mode) -->
				{#if selectedSpecies}
					<g class="y-axis">
						{#each yTicks as tick}
							<g transform="translate(0, {yScale(tick)})">
								<text x="-12" text-anchor="end" dominant-baseline="middle" class="axis-label">
									{tick.toFixed(0)}
								</text>
							</g>
						{/each}
						<text
							transform="rotate(-90)"
							x={-height / 2}
							y="-40"
							text-anchor="middle"
							class="axis-title"
						>
							Detections / day
						</text>
					</g>

					<!-- Temperature Y axis (right side) -->
					{#if showTemperature}
						{@const tempTicks = tempScale.ticks(5)}
						<g class="y-axis temp-axis" transform="translate({width}, 0)">
							{#each tempTicks as tick}
								<g transform="translate(0, {tempScale(tick)})">
									<text 
										x="12" 
										text-anchor="start" 
										dominant-baseline="middle" 
										class="axis-label temp"
										fill={tempColorScale(tick)}
										style="opacity: 0.9"
									>
										{tick.toFixed(0)}°
									</text>
								</g>
							{/each}
							<text
								transform="rotate(90)"
								x={height / 2}
								y="-40"
								text-anchor="middle"
								class="axis-title temp"
							>
								Temperature (°C)
							</text>
						</g>
					{/if}

					<!-- NDVI Y axis (right side) -->
					{#if showNdvi && !showTemperature}
						{@const ndviTicks = ndviScale.ticks(5)}
						<g class="y-axis ndvi-axis" transform="translate({width}, 0)">
							{#each ndviTicks as tick}
								<g transform="translate(0, {ndviScale(tick)})">
									<text 
										x="12" 
										text-anchor="start" 
										dominant-baseline="middle" 
										class="axis-label ndvi"
										fill={ndviColorScale(tick)}
										style="opacity: 0.9"
									>
										{tick.toFixed(2)}
									</text>
								</g>
							{/each}
							<text
								transform="rotate(90)"
								x={height / 2}
								y="-40"
								text-anchor="middle"
								class="axis-title ndvi"
							>
								NDVI
							</text>
						</g>
					{/if}
				{/if}
			</g>
		</g>
	</svg>

	<!-- Tooltip -->
	{#if tooltip.show}
		<div 
			class="tooltip"
			style="left: {tooltip.x + 10}px; top: {tooltip.y - 10}px;"
		>
			<div class="tooltip-content">
				<div class="tooltip-icon">
					{#if tooltip.imageSrc}
						<img src={tooltip.imageSrc} alt={getCommonName(tooltip.species, birdData ?? undefined)} />
					{:else}
						<div class="color-dot" style="background: {colorScale(tooltip.species)}"></div>
					{/if}
				</div>
				<div class="tooltip-text">
					<div class="tooltip-name">{getCommonName(tooltip.species, birdData ?? undefined)}</div>
					<div class="tooltip-value">{tooltip.value} detections</div>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.chart-container {
		width: 100%;
		height: 100%;
		min-height: 250px;
	}

	.chart-svg {
		display: block;
		width: 100%;
		height: 100%;
	}

	.month-label {
		fill: rgba(255, 255, 255, 0.9);
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		transition: opacity 0.3s ease-out;
	}

	.axis-label {
		font-size: 11px;
		fill: rgba(255, 255, 255, 0.5);
		transition: opacity 0.3s ease-out, transform 0.3s ease-out;
	}

	.axis-title {
		font-size: 12px;
		fill: rgba(255, 255, 255, 0.6);
		font-weight: 500;
	}

	/* Animated path transitions */
	.animated-path {
		transition: d 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease-out;
	}

	.animated-line {
		transition: d 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease-out, stroke-width 0.2s ease-out;
	}

	.stream-path {
		transition: d 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.15s ease-out;
	}

	.stream-path:hover {
		opacity: 1;
	}

	.mean-line {
		transition: d 0.4s cubic-bezier(0.4, 0, 0.2, 1), stroke-width 0.15s ease-out;
	}

	.site-line {
		pointer-events: none;
		transition: d 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease-out;
	}

	/* Fade in/out animations for view transitions */
	@keyframes fadeInPath {
		from { opacity: 0; }
		to { opacity: 0.85; }
	}

	@keyframes fadeInLine {
		from { opacity: 0; stroke-dashoffset: 1000; }
		to { opacity: 1; stroke-dashoffset: 0; }
	}



	.y-axis {
		transition: opacity 0.3s ease-out;
	}

	/* Temperature and Precipitation styles */
	.temp-line {
		transition: d 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease-out;
	}

	.temp-area {
		transition: d 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease-out;
	}

	.precip-bar {
		transition: height 0.3s ease-out, y 0.3s ease-out;
	}

	.axis-label.temp {
		fill: rgba(255, 107, 53, 0.7);
	}

	.axis-title.temp {
		fill: rgba(255, 107, 53, 0.6);
	}

	/* NDVI styles */
	.ndvi-logger-line {
		pointer-events: none;
		transition: d 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease-out;
	}

	.axis-label.ndvi {
		fill: rgba(34, 197, 94, 0.8);
	}

	.axis-title.ndvi {
		fill: rgba(34, 197, 94, 0.7);
	}

	/* Tooltip */
	.tooltip {
		position: absolute;
		pointer-events: none;
		z-index: 1000;
	}

	.tooltip-content {
		display: flex;
		align-items: center;
		gap: 8px;
		background: rgba(0, 0, 0, 0.7);
		color: rgba(255, 255, 255, 0.9);
		padding: 8px 12px;
		border-radius: 6px;
		font-size: 14px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(255, 255, 255, 0.05);
	}

	.tooltip-icon {
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.tooltip-icon img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		border-radius: 4px;
	}

	.color-dot {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 2px solid rgba(255, 255, 255, 0.3);
	}

	.tooltip-text {
		min-width: 0;
	}

	.tooltip-name {
		font-weight: 600;
		margin-bottom: 1px;
	}

	.tooltip-value {
		font-size: 12px;
		opacity: 0.8;
	}
</style>
