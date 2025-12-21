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

    // Minimal tooltip state
    interface TooltipData {
        show: boolean;
        x: number;
        y: number;
        chartX: number;
        date: Date | null;
        species: { name: string; value: number; color: string; imageSrc: string | null } | null;
        temperature?: { min: number; max: number; mean: number };
        precipitation?: number;
        ndvi?: number;
    }

    let tooltip = $state<TooltipData>({ 
        show: false, 
        x: 0, 
        y: 0, 
        chartX: 0,
        date: null,
        species: null,
        temperature: undefined,
        precipitation: undefined,
        ndvi: undefined
    });

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
    const dateFormatter = d3.utcFormat('%b %d, %Y');
    const yTicks = $derived(yScale.ticks(5));

    // Enhanced tooltip handler
    function updateTooltip(event: MouseEvent) {
        const rect = containerEl?.getBoundingClientRect();
        if (!rect || dates.length === 0) return;

        // Convert client coordinates to SVG user coordinates to account for viewBox scaling
        const svgEl = containerEl?.querySelector('svg') as SVGSVGElement | null;
        let mouseX: number;
        let mouseY: number;

        if (svgEl) {
            // Try the robust CTM-based conversion first
            const pt = svgEl.createSVGPoint();
            pt.x = event.clientX;
            pt.y = event.clientY;
            const ctm = svgEl.getScreenCTM && svgEl.getScreenCTM();
            if (ctm) {
                const svgP = pt.matrixTransform(ctm.inverse());
                mouseX = svgP.x - PADDING.left;
                mouseY = svgP.y - PADDING.top;
            } else {
                // Fallback: use bounding rect and viewBox scale
                const svgRect = svgEl.getBoundingClientRect();
                const vb = svgEl.viewBox.baseVal;
                const scaleX = vb.width / svgRect.width;
                const scaleY = vb.height / svgRect.height;
                mouseX = (event.clientX - svgRect.left) * scaleX - PADDING.left;
                mouseY = (event.clientY - svgRect.top) * scaleY - PADDING.top;
            }
        } else {
            // Final fallback: use container rect (legacy behavior)
            mouseX = event.clientX - rect.left - PADDING.left;
            mouseY = event.clientY - rect.top - PADDING.top;
        }

        // Check if mouse is within chart bounds
        if (mouseX < 0 || mouseX > width || mouseY < 0 || mouseY > height) {
            tooltip.show = false;
            return;
        }

        // Find the nearest date index
        const date = xScale.invert(mouseX);
        const bisect = d3.bisector((d: Date) => d).left;
        const index = bisect(dates, date, 1);
        const i = Math.max(0, Math.min(index, dates.length - 1));
        const nearestDate = dates[i];

        let speciesData: { name: string; value: number; color: string; imageSrc: string | null } | null = null;

        if (selectedSpecies) {
            // Single species mode
            const sp = displaySpecies[0];
            if (sp) {
                const value = sp.timeSeries.mean[i] ?? 0;
                const speciesInfo = getSpeciesData(sp.name, birdData ?? undefined);
                const speciesCode = speciesInfo?.species_code;
                const imageSrc = speciesCode ? imageMap[speciesCode] : null;
                speciesData = {
                    name: sp.name,
                    value: Math.round(value * 10) / 10,
                    color: colorScale(sp.name),
                    imageSrc
                };
            }
        } else if (stackedData) {
            // Stream view - find which species the mouse is hovering over
            // Check each series to see if mouseY is within its bounds at this x position
            for (const series of stackedData) {
                const point = series[i];
                const y0 = yScale(point[0]);
                const y1 = yScale(point[1]);
                
                // Check if mouse Y is within this stream
                if (mouseY >= y1 && mouseY <= y0) {
                    const value = point[1] - point[0];
                    const speciesInfo = getSpeciesData(series.key, birdData ?? undefined);
                    const speciesCode = speciesInfo?.species_code;
                    const imageSrc = speciesCode ? imageMap[speciesCode] : null;
                    speciesData = {
                        name: series.key,
                        value: Math.round(value * 10) / 10,
                        color: colorScale(series.key),
                        imageSrc
                    };
                    break;
                }
            }
        }

        // Get weather data for this date
        const dateKey = nearestDate.toISOString().slice(0, 10);
        const weather = weatherByDate.get(dateKey);

        // Get NDVI data for this date (average across loggers)
        let ndviValue: number | undefined;
        if (ndviData && showNdvi) {
            const ndviValues: number[] = [];
            for (const [_, logger] of ndviData.loggers) {
                const ndviIdx = logger.dates.findIndex(d => 
                    Math.abs(d.getTime() - nearestDate.getTime()) < 24 * 60 * 60 * 1000
                );
                if (ndviIdx >= 0 && logger.ndvi[ndviIdx] != null) {
                    ndviValues.push(logger.ndvi[ndviIdx]);
                }
            }
            if (ndviValues.length > 0) {
                ndviValue = ndviValues.reduce((a, b) => a + b, 0) / ndviValues.length;
            }
        }

        tooltip = {
            show: true,
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            chartX: mouseX, // Use actual mouse X position for the line
            date: nearestDate,
            species: speciesData,
            temperature: weather && showTemperature ? {
                min: weather.temperatureMin,
                max: weather.temperatureMax,
                mean: weather.temperatureMean
            } : undefined,
            precipitation: weather && showPrecipitation ? weather.precipitationSum : undefined,
            ndvi: ndviValue
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

            <!-- Vertical line indicator for tooltip -->
            {#if tooltip.show}
                <line
                    x1={tooltip.chartX}
                    x2={tooltip.chartX}
                    y1="0"
                    y2={height}
                    stroke="rgba(255, 255, 255, 0.5)"
                    stroke-width="1.5"
                    stroke-dasharray="4 4"
                    class="tooltip-line"
                    transition:fade={{ duration: 100 }}
                />
            {/if}

            <!-- Invisible overlay for mouse tracking -->
            <rect
                x="0"
                y="0"
                width={width}
                height={height}
                fill="transparent"
                onmousemove={updateTooltip}
                onmouseleave={hideTooltip}
                class="interaction-overlay"
            />
        </g>
    </svg>

    <!-- Minimal Tooltip -->
    {#if tooltip.show && tooltip.species}
        {@const tooltipLeft = tooltip.x + 15 > containerWidth - 200}
        <div 
            class="tooltip"
            class:tooltip-left={tooltipLeft}
            style="left: {tooltipLeft ? tooltip.x - 170 : tooltip.x + 15}px; top: {Math.min(tooltip.y + 10, containerHeight - 150)}px;"
            transition:fade={{ duration: 100 }}
        >
            <div class="tooltip-header">
                <!-- Mirror legend button appearance: colored circular background with bird image on top -->
                <div class="tooltip-icon" style="--species-color: {tooltip.species.color}">
                    {#if tooltip.species.imageSrc}
                        <img src={tooltip.species.imageSrc} alt={getCommonName(tooltip.species.name, birdData ?? undefined)} />
                    {:else}
                        <div class="color-dot"></div>
                    {/if}
                </div>
                <div class="tooltip-main">
                    <div class="tooltip-species-name">{getCommonName(tooltip.species.name, birdData ?? undefined)}</div>
                    <div class="tooltip-value">{tooltip.species.value} detections/day</div>
                </div>
            </div>
            
            {#if tooltip.date}
                <div class="tooltip-date">{dateFormatter(tooltip.date)}</div>
            {/if}

            {#if tooltip.temperature || tooltip.precipitation !== undefined || tooltip.ndvi !== undefined}
                <div class="tooltip-extras">
                    {#if tooltip.temperature}
                        <div class="tooltip-extra">
                            <span class="extra-label">Temp:</span>
                            <span>{tooltip.temperature.mean.toFixed(1)}°C</span>
                        </div>
                    {/if}
                    {#if tooltip.precipitation !== undefined && tooltip.precipitation > 0}
                        <div class="tooltip-extra">
                            <span class="extra-label">Precip:</span>
                            <span>{tooltip.precipitation.toFixed(1)} mm</span>
                        </div>
                    {/if}
                    {#if tooltip.ndvi !== undefined}
                        <div class="tooltip-extra">
                            <span class="extra-label">NDVI:</span>
                            <span>{tooltip.ndvi.toFixed(3)}</span>
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
    {/if}
</div>

<style>
    .chart-container {
        width: 100%;
        height: 100%;
        min-height: 250px;
        position: relative;
    }

    .chart-svg {
        display: block;
        width: 100%;
        height: 100%;
    }

    .interaction-overlay {
        cursor: crosshair;
    }

    .tooltip-line {
        pointer-events: none;
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

    .mean-line {
        transition: d 0.4s cubic-bezier(0.4, 0, 0.2, 1), stroke-width 0.15s ease-out;
    }

    .site-line {
        pointer-events: none;
        transition: d 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease-out;
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

    /* Minimal Tooltip */
    .tooltip {
        position: absolute;
        pointer-events: none;
        z-index: 1000;
        /* Flatter, neutral background (not bluish) */
        background: rgba(30, 30, 30, 0.97);
        color: rgba(255, 255, 255, 0.95);
        padding: 8px 10px;
        border-radius: 4px;
        font-size: 12px;
        /* Remove shadow and blur for a flatter look */
        box-shadow: none;
        backdrop-filter: none;
        border: 1px solid rgba(255, 255, 255, 0.06);
        min-width: 160px;
        overflow: visible;
    }

    .tooltip-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 4px;
    }

    .tooltip-icon {
        position: relative;
        flex-shrink: 0;
        width: 72px; /* larger outer container to match legend size */
        height: 72px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%; /* outer container */
        overflow: visible; /* allow bird to extend over the circular background like the legend */
        padding: 6px; /* inner padding so the bird sits comfortably */
        box-sizing: border-box;
    }

    /* Background circle using species color (matches legend .bird-icon::before) */
    .tooltip-icon::before {
        content: '';
        position: absolute;
        width: 56px; /* slightly larger background circle */
        height: 56px;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        background: var(--species-color, rgba(255, 255, 255, 0.04));
        border-radius: 50%;
        z-index: 0;
        transition: transform 0.15s ease-out;
    }

    .tooltip-icon img {
        /* make illustration larger than the legend so it reads big in the tooltip */
        width: 80px;
        height: 80px;
        object-fit: contain; /* ensure the entire bird fits without cropping */
        border-radius: 0; /* no clipping, let it overlap the background circle */
        display: block;
        position: relative;
        z-index: 1; /* above the background circle */
        filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.35));
        transform-origin: center center;
        backface-visibility: hidden;
        transform: scale(1.04);
    }

    .color-dot {
        width: 56px; /* fill the background circle */
        height: 56px;
        border-radius: 50%;
        background: var(--species-color);
        border: none;
        box-shadow: 0 0 12px var(--species-color);
        position: relative;
        z-index: 1;
    }

    .tooltip-main {
        flex: 1;
        min-width: 0;
    }

    .tooltip-species-name {
        font-weight: 600;
        font-size: 13px;
        line-height: 1.3;
        color: rgba(255, 255, 255, 0.95);
    }

    .tooltip-value {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.65);
        margin-top: 1px;
    }

    .tooltip-date {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.5);
        margin-top: 4px;
        padding-top: 4px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    }

    .tooltip-extras {
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .tooltip-extra {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        line-height: 1.4;
    }

    .extra-label {
        color: rgba(255, 255, 255, 0.5);
    }
</style>
