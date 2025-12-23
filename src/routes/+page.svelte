<script lang="ts">
	import { onMount } from 'svelte';
	import * as d3 from 'd3';
	import ActivityChart from '$lib/ActivityChart.svelte';
	import SpeciesSelector from '$lib/SpeciesSelector.svelte';
	import ViewControls from '$lib/ViewControls.svelte';
	import KDEMap from '$lib/KDEMap.svelte';
	import type { SpeciesData } from '$lib/types';
	import { getCommonName, getBaseName, getSpeciesData } from '$lib/types';
	import { loadAllData, subscribeToLoading, type LoadingProgress } from '$lib/dataStore';

	let data = $state<SpeciesData | null>(null);
	let loading = $state(true);
	let loadingProgress = $state<LoadingProgress>({ stage: 'idle', message: 'Initializing...', progress: 0 });
	let error = $state<string | null>(null);

	// UI state
	let selectedSpecies = $state<string | null>(null);
	let showSiteLines = $state(false);
	let showTemperature = $state(false);
	let showPrecipitation = $state(false);
	let showNdvi = $state(false);
	let viewMode = $state<'chart' | 'map'>('chart');
	
	// Mobile UI state
	let mobileSheetOpen = $state(false);
	let mobileControlsOpen = $state(false);

	let birdData = $state<Record<string, {common_name: string, species_code: string}> | null>(null);

	const imageMap = $state<Record<string, string>>({
		'coatit': '/bird-illustrations/coatit11_153091521.png',
		'comchi': '/bird-illustrations/comchi5_153500441.png',
		'eubtit': '/bird-illustrations/eubtit2_153092381.png',
		'eurbla': '/bird-illustrations/eurbla5_153116731.png',
		'eurnut': '/bird-illustrations/eurnut23_153513341.png',
		'eurrob': '/bird-illustrations/eurrob1_153149541.png',
		'eurwre': '/bird-illustrations/eurwre9_153132761.png',
		'sonthr': '/bird-illustrations/sonthr4_153523991.png',
		'tawowl': '/bird-illustrations/tawowl4_151480341.png',
	});

	// Interpolate colors from teal to gold (like the example)
	const colorScale = $derived.by(() => {
		const interpolator = d3.interpolateRgb('#197569', '#ffd000');
		const colors = Array.from({ length: 10 }, (_, i) => interpolator(i / 9));
		return d3.scaleOrdinal<string>().range(colors);
	});

	onMount(() => {
		// Subscribe to loading progress updates
		const unsubscribe = subscribeToLoading((progress) => {
			loadingProgress = progress;
		});

		// Load all data upfront
		loadAllData(imageMap)
			.then((appData) => {
				data = appData.speciesData;
				birdData = appData.birdData;
				
				// Set domain for color scale
				if (data?.species) {
					colorScale.domain(data.species.map(s => s.name));
				}
				
				loading = false;
			})
			.catch((e) => {
				error = e instanceof Error ? e.message : 'Unknown error';
				loading = false;
			});

		return unsubscribe;
	});

	function handleSpeciesSelect(name: string | null) {
		selectedSpecies = name;
	}

	function toggleSiteLines() {
		showSiteLines = !showSiteLines;
	}

	function toggleTemperature() {
		showTemperature = !showTemperature;
	}

	function togglePrecipitation() {
		showPrecipitation = !showPrecipitation;
	}

	function toggleNdvi() {
		showNdvi = !showNdvi;
	}

	function toggleMobileSheet() {
		mobileSheetOpen = !mobileSheetOpen;
	}

	function toggleMobileControls() {
		mobileControlsOpen = !mobileControlsOpen;
	}

	function handleMobileSpeciesSelect(name: string | null) {
		handleSpeciesSelect(name);
		mobileSheetOpen = false;
	}

	function setViewMode(mode: 'chart' | 'map') {
		viewMode = mode;
	}

	// Derived values
	const displayScientificName = $derived(selectedSpecies ? getBaseName(selectedSpecies) : null);
	const chartTitle = $derived(
		viewMode === 'map' 
			? (selectedSpecies 
				? getCommonName(displayScientificName ?? selectedSpecies, birdData ?? undefined)
				: 'Detection Density')
			: (selectedSpecies 
				? getCommonName(displayScientificName ?? selectedSpecies, birdData ?? undefined)
				: 'Activity Streams')
	);

	const subtitle = $derived(
		data ? `${data.metadata.dateRange.start} – ${data.metadata.dateRange.end}` : ''
	);

	const selectedSpeciesImage = $derived(() => {
		if (!selectedSpecies || !birdData) return null;
		const speciesData = getSpeciesData(selectedSpecies, birdData);
		const code = speciesData?.species_code;
		return code ? imageMap[code] : null;
	});
</script>

<svelte:head>
	<title>Wytham Woods Acoustic Monitor</title>
</svelte:head>

<main>
	{#if loading}
		<div class="loading-screen">
			<div class="loading-content">
				<div class="loading-header">
					<span class="loading-pre-title">the</span>
					<h1 class="loading-title">WYTHAM WOODS</h1>
					<span class="loading-sub-title">Acoustic Monitor</span>
				</div>
				
				<div class="loading-progress-container">
					<div class="loading-progress-bar">
						<div 
							class="loading-progress-fill" 
							style="width: {loadingProgress.progress}%"
						></div>
					</div>
					<div class="loading-status">
						<span class="loading-message">{loadingProgress.message}</span>
						<span class="loading-percent">{loadingProgress.progress}%</span>
					</div>
				</div>
				
				<div class="loading-stages">
					<div class="loading-stage" class:active={loadingProgress.stage === 'species'} class:done={loadingProgress.progress > 25}>
						<div class="stage-icon">
							{#if loadingProgress.progress > 25}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
							{:else}
								<div class="stage-dot"></div>
							{/if}
						</div>
						<span>Detection data</span>
					</div>
					<div class="loading-stage" class:active={loadingProgress.stage === 'loggers'} class:done={loadingProgress.progress > 40}>
						<div class="stage-icon">
							{#if loadingProgress.progress > 40}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
							{:else}
								<div class="stage-dot"></div>
							{/if}
						</div>
						<span>Sensor network</span>
					</div>
					<div class="loading-stage" class:active={loadingProgress.stage === 'birds' || loadingProgress.stage === 'ndvi' || loadingProgress.stage === 'processing'} class:done={loadingProgress.progress > 70}>
						<div class="stage-icon">
							{#if loadingProgress.progress > 70}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
							{:else}
								<div class="stage-dot"></div>
							{/if}
						</div>
						<span>Processing data</span>
					</div>
					<div class="loading-stage" class:active={loadingProgress.stage === 'weather' || loadingProgress.stage === 'images'} class:done={loadingProgress.progress >= 100}>
						<div class="stage-icon">
							{#if loadingProgress.progress >= 100}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
							{:else}
								<div class="stage-dot"></div>
							{/if}
						</div>
						<span>Weather & images</span>
					</div>
				</div>
			</div>
		</div>
	{:else if error}
		<div class="error">
			<p>Error: {error}</p>
		</div>
	{:else if data}
		<!-- Desktop Layout -->
		<div class="app-container desktop-only">
			<!-- Header -->
			<header>
				<div class="title-block">
					<span class="pre-title">the</span>
					<h1>WYTHAM WOODS</h1>
					<span class="sub-title">Acoustic Monitor</span>
				</div>
				<div class="header-right">
					<div class="stats">
						<div class="stat">
							<span class="stat-value">{data.metadata.nSpecies}</span>
							<span class="stat-label">species</span>
						</div>
						<div class="stat">
							<span class="stat-value">{data.metadata.nSites}</span>
							<span class="stat-label">loggers</span>
						</div>
						<div class="stat">
							<span class="stat-value">{data.metadata.nDays}</span>
							<span class="stat-label">days</span>
						</div>
					</div>
				</div>
			</header>

			<!-- Chart area -->
			<section class="chart-section">
				<div class="chart-header">
					<div class="chart-title-group">
						<h2>{chartTitle}</h2>
						{#if selectedSpecies}
							<span class="scientific-name">{displayScientificName}</span>
						{:else if viewMode === 'chart'}
							<span class="chart-description">Daily detections for top 10 species</span>
						{:else}
							<span class="chart-description">Spatial density by week</span>
						{/if}
					</div>
					<div class="chart-controls">
						<!-- View mode toggle -->
						{#if viewMode === 'chart'}
							<ViewControls 
								{showSiteLines}
								onToggleSiteLines={toggleSiteLines}
								siteCount={data.metadata.nSites}
								{selectedSpecies}
								{showTemperature}
								onToggleTemperature={toggleTemperature}
								{showPrecipitation}
								onTogglePrecipitation={togglePrecipitation}
								{showNdvi}
								onToggleNdvi={toggleNdvi}
							/>
						{/if}
						
						<div class="view-mode-toggle">
							<button 
								class="mode-btn" 
								class:active={viewMode === 'chart'}
								onclick={() => setViewMode('chart')}
								aria-label="Chart view"
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<rect x="3" y="10" width="4" height="11" rx="1"/>
									<rect x="10" y="6" width="4" height="15" rx="1"/>
									<rect x="17" y="3" width="4" height="18" rx="1"/>
								</svg>
								<span>Timeline</span>
							</button>
							<button 
								class="mode-btn" 
								class:active={viewMode === 'map'}
								onclick={() => setViewMode('map')}
								aria-label="Map view"
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<circle cx="12" cy="12" r="3" fill="currentColor" opacity="0.3"/>
									<circle cx="12" cy="12" r="6" opacity="0.5"/>
									<circle cx="12" cy="12" r="9"/>
								</svg>
								<span>Density</span>
							</button>
						</div>
					</div>
				</div>
				
				<div class="chart-wrapper">
					{#if viewMode === 'chart'}
						{#if selectedSpecies && selectedSpeciesImage()}
							<div class="species-image-overlay">
								<img src={selectedSpeciesImage()} alt={chartTitle} />
							</div>
						{/if}
						<ActivityChart 
							species={data.species}
							{selectedSpecies}
							{showSiteLines}
							{colorScale}
							{birdData}
							{imageMap}
							{showTemperature}
							{showPrecipitation}
							{showNdvi}
							dateRange={data.metadata.dateRange}
						/>
					{:else}
						<KDEMap
							species={data.species}
							{selectedSpecies}
							{colorScale}
							{birdData}
							{imageMap}
						/>
					{/if}
				</div>
			</section>

			<!-- Legend/Selector -->
			<section class="legend-section">
				<SpeciesSelector 
					species={data.species}
					{selectedSpecies}
					onSelect={handleSpeciesSelect}
					{colorScale}
					{birdData}
					{imageMap}
				/>
			</section>
		</div>

		<!-- Mobile Layout -->
		<div class="mobile-app mobile-only">
			<!-- Compact Mobile Header -->
			<header class="mobile-header">
				<div class="mobile-title-block">
					<span class="mobile-pre-title">the</span>
					<h1 class="mobile-main-title">WYTHAM WOODS</h1>
					<span class="mobile-sub-title">Acoustic Monitor</span>
				</div>
				<div class="mobile-header-right">
					<div class="mobile-stats">
						<div class="mobile-stat">
							<span class="mobile-stat-value">{data.metadata.nSpecies}</span>
							<span class="mobile-stat-label">species</span>
						</div>
						<div class="mobile-stat">
							<span class="mobile-stat-value">{data.metadata.nSites}</span>
							<span class="mobile-stat-label">loggers</span>
						</div>
						<div class="mobile-stat">
							<span class="mobile-stat-value">{data.metadata.nDays}</span>
							<span class="mobile-stat-label">days</span>
						</div>
					</div>
				</div>
			</header>

			<!-- Mobile Chart Area -->
			<section class="mobile-chart-section" class:stream-view={!selectedSpecies && viewMode === 'chart'}>
				<!-- View mode toggle (mobile) -->
				<div class="mobile-view-toggle">
					<button 
						class="mobile-mode-btn" 
						class:active={viewMode === 'chart'}
						onclick={() => setViewMode('chart')}
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<rect x="3" y="10" width="4" height="11" rx="1"/>
							<rect x="10" y="6" width="4" height="15" rx="1"/>
							<rect x="17" y="3" width="4" height="18" rx="1"/>
						</svg>
						<span>Timeline</span>
					</button>
					<button 
						class="mobile-mode-btn" 
						class:active={viewMode === 'map'}
						onclick={() => setViewMode('map')}
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<circle cx="12" cy="12" r="3" fill="currentColor" opacity="0.3"/>
							<circle cx="12" cy="12" r="6" opacity="0.5"/>
							<circle cx="12" cy="12" r="9"/>
						</svg>
						<span>Density</span>
					</button>
				</div>

				<!-- Species Info Bar (when species selected and chart view) -->
				{#if selectedSpecies && viewMode === 'chart'}
					<div class="mobile-species-bar">
						<div class="mobile-species-info">
							<div class="mobile-chart-title">
								<h2>{chartTitle}</h2>
								<span class="mobile-scientific">{displayScientificName}</span>
							</div>
							<div class="mobile-toggles-row">
								<button 
									class="mobile-pill" 
									class:active={showSiteLines}
									onclick={toggleSiteLines}
								>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<circle cx="12" cy="12" r="2"/>
										<circle cx="6" cy="6" r="1.5"/>
										<circle cx="18" cy="6" r="1.5"/>
										<circle cx="6" cy="18" r="1.5"/>
										<circle cx="18" cy="18" r="1.5"/>
									</svg>
									<span>Sites</span>
								</button>
								<button 
									class="mobile-pill temp" 
									class:active={showTemperature}
									onclick={toggleTemperature}
								>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>
									</svg>
									<span>Temp</span>
								</button>
								<button 
									class="mobile-pill precip" 
									class:active={showPrecipitation}
									onclick={togglePrecipitation}
								>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
									</svg>
									<span>Rain</span>
								</button>
								<button 
									class="mobile-pill ndvi" 
									class:active={showNdvi}
									onclick={toggleNdvi}
								>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<path d="M12 22c-4.97 0-9-2.69-9-6v-.5C3 11.57 7.03 9 12 9s9 2.57 9 6.5v.5c0 3.31-4.03 6-9 6z"/>
										<path d="M12 9V2"/>
										<path d="M12 9c-2 0-4-2-4-4"/>
										<path d="M12 9c2 0 4-2 4-4"/>
									</svg>
									<span>NDVI</span>
								</button>
							</div>
						</div>
						{#if selectedSpeciesImage()}
							<div class="mobile-species-image" style="--species-color: {colorScale(selectedSpecies)}">
								<img src={selectedSpeciesImage()} alt={chartTitle} />
							</div>
						{/if}
					</div>
				{:else if viewMode === 'chart'}
					<!-- Stream view header -->
					<div class="mobile-chart-header">
						<div class="mobile-chart-title">
							<h2>{chartTitle}</h2>
						</div>
					</div>
				{:else if selectedSpecies}
					<!-- Map view with species selected header -->
					<div class="mobile-chart-header">
						<div class="mobile-chart-title">
							<h2>{chartTitle}</h2>
							<span class="mobile-scientific">{displayScientificName}</span>
						</div>
					</div>
				{:else}
					<!-- Map view header -->
					<div class="mobile-chart-header">
						<div class="mobile-chart-title">
							<h2>{chartTitle}</h2>
							<span class="mobile-scientific">Spatial density by week</span>
						</div>
					</div>
				{/if}

				<!-- Chart or Map -->
				<div class="mobile-chart-wrapper" class:stream-view={!selectedSpecies && viewMode === 'chart'}>
					{#if viewMode === 'chart'}
						<ActivityChart 
							species={data.species}
							{selectedSpecies}
							{showSiteLines}
							{colorScale}
							{birdData}
							{imageMap}
							{showTemperature}
							{showPrecipitation}
							{showNdvi}
							dateRange={data.metadata.dateRange}
							isMobile={true}
						/>
					{:else}
						<KDEMap
							species={data.species}
							{selectedSpecies}
							{colorScale}
							{birdData}
							{imageMap}
							isMobile={true}
						/>
					{/if}
				</div>
			</section>

			<!-- Mobile Bottom Sheet -->
			<div class="mobile-sheet" class:open={mobileSheetOpen}>
				<!-- Sheet Handle -->
				<button class="sheet-handle" onclick={toggleMobileSheet}>
					<span class="sheet-peek">
						{#if selectedSpecies}
							{@const speciesData = getSpeciesData(selectedSpecies, birdData ?? undefined)}
							{@const code = speciesData?.species_code}
							{@const imgSrc = code ? imageMap[code] : null}
							{#if imgSrc}
								<img src={imgSrc} alt="" class="peek-image" />
							{:else}
								<span class="peek-dot" style="background: {colorScale(selectedSpecies)}"></span>
							{/if}
							<span class="peek-text">{getCommonName(getBaseName(selectedSpecies), birdData ?? undefined)}</span>
						{:else}
							<span class="peek-text">Select a species</span>
						{/if}
						<svg class="sheet-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<polyline points="18 15 12 9 6 15"></polyline>
						</svg>
					</span>
				</button>

				<!-- Sheet Content -->
				<div class="sheet-content">
					<div class="species-grid">
						{#each [...data.species].sort((a, b) => b.total - a.total) as sp (sp.name)}
							{@const isActive = selectedSpecies === sp.name}
							{@const speciesData = getSpeciesData(sp.name, birdData ?? undefined)}
							{@const speciesCode = speciesData?.species_code}
							{@const imageSrc = speciesCode ? imageMap[speciesCode] : null}
							{@const commonName = getCommonName(sp.name, birdData ?? undefined)}
							<button
								class="species-card"
								class:active={isActive}
								onclick={() => handleMobileSpeciesSelect(isActive ? null : sp.name)}
							>
								<div class="card-icon" style="--species-color: {colorScale(sp.name)}">
									{#if imageSrc}
										<img src={imageSrc} alt={commonName} />
									{:else}
										<div class="card-dot"></div>
									{/if}
								</div>
								<span class="card-name">{commonName}</span>
							</button>
						{/each}
					</div>
				</div>
			</div>

			<!-- Backdrop -->
			{#if mobileSheetOpen}
				<button class="mobile-backdrop" onclick={toggleMobileSheet} aria-label="Close species selector"></button>
			{/if}
		</div>
	{/if}
</main>

<style>
	main {
		width: 100%;
		height: 100vh;
		background: var(--color-bg);
		overflow: hidden;
	}

	.app-container {
		max-width: 1400px;
		margin: 0 auto;
		padding: 24px 32px 16px 32px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		height: 100vh;
		animation: fadeIn 0.4s ease-out;
	}

	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(12px); }
		to { opacity: 1; transform: translateY(0); }
	}

	/* Loading Screen */
	.loading-screen {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		background: var(--color-bg);
	}

	.loading-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 40px;
		max-width: 320px;
		width: 100%;
		padding: 24px;
	}

	.loading-header {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0px;
	}

	.loading-pre-title {
		font-family: var(--font-serif);
		font-size: 14px;
		color: var(--color-text-dim);
		font-style: italic;
		margin-bottom: -2px;
	}

	.loading-title {
		font-size: 28px;
		font-weight: 700;
		letter-spacing: 0.15em;
		color: var(--color-text);
		margin: -4px 0;
	}

	.loading-sub-title {
		font-size: 12px;
		font-weight: 500;
		color: var(--color-text-muted);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		margin-top: -2px;
	}

	.loading-progress-container {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.loading-progress-bar {
		width: 100%;
		height: 4px;
		background: rgba(255, 255, 255, 0.1);
		border-radius: 2px;
		overflow: hidden;
	}

	.loading-progress-fill {
		height: 100%;
		background: linear-gradient(90deg, var(--color-primary) 0%, var(--color-secondary) 100%);
		border-radius: 2px;
		transition: width 0.3s ease-out;
	}

	.loading-status {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.loading-message {
		font-size: 13px;
		color: var(--color-text-muted);
	}

	.loading-percent {
		font-size: 12px;
		font-weight: 600;
		color: var(--color-text-dim);
		font-variant-numeric: tabular-nums;
	}

	.loading-stages {
		display: flex;
		flex-direction: column;
		gap: 12px;
		width: 100%;
	}

	.loading-stage {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 13px;
		color: var(--color-text-dim);
		transition: color 0.2s ease;
	}

	.loading-stage.active {
		color: var(--color-text);
	}

	.loading-stage.done {
		color: var(--color-primary);
	}

	.stage-icon {
		width: 20px;
		height: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.stage-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
		opacity: 0.5;
	}

	.loading-stage.active .stage-dot {
		opacity: 1;
		animation: pulse 1s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { transform: scale(1); opacity: 1; }
		50% { transform: scale(1.3); opacity: 0.7; }
	}

	.loading, .error {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		gap: 16px;
		color: var(--color-text-muted);
	}

	.spinner {
		width: 28px;
		height: 28px;
		border: 2px solid rgba(255, 255, 255, 0.1);
		border-top-color: rgba(255, 255, 255, 0.8);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.error {
		color: #ef4444;
	}

	/* Header */
	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		padding: 16px 0 12px 0;
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.header-right {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 12px;
	}

	.title-block {
		display: flex;
		flex-direction: column;
		gap: 0;
		line-height: 1;
	}

	.pre-title {
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 14px;
		color: var(--color-text-muted);
		letter-spacing: 0.05em;
		margin-bottom: 1px;
	}

	h1 {
		font-family: var(--font-serif);
		font-size: 26px;
		font-weight: 400;
		color: var(--color-text);
		margin: 0;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.sub-title {
		font-family: var(--font-sans);
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-muted);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		margin-top: 2px;
	}

	.stats {
		display: flex;
		gap: 32px;
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}

	.stat-value {
		font-size: 20px;
		font-weight: 600;
		color: var(--color-text);
		letter-spacing: -0.02em;
	}

	.stat-label {
		font-size: 10px;
		font-weight: 500;
		color: var(--color-text-dim);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	/* Chart section */
	.chart-section {
		background: var(--color-bg-elevated);
		border-radius: 12px;
		padding: 20px 24px 24px 24px;
		border: 1px solid var(--color-border-subtle);
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.chart-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 12px;
		flex-shrink: 0;
	}

	.chart-controls {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	/* View mode toggle (segmented control) */
	.view-mode-toggle {
		display: flex;
		background: rgba(255, 255, 255, 0.04);
		border-radius: 20px;
		padding: 3px;
		gap: 2px;
		border: 1px solid rgba(255, 255, 255, 0.08);
	}

	.mode-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 14px;
		border: none;
		border-radius: 16px;
		background: transparent;
		color: rgba(255, 255, 255, 0.45);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.mode-btn:hover {
		color: rgba(255, 255, 255, 0.7);
		background: rgba(255, 255, 255, 0.04);
	}

	.mode-btn.active {
		background: rgba(255, 255, 255, 0.1);
		color: rgba(255, 255, 255, 0.95);
	}

	.mode-btn svg {
		flex-shrink: 0;
		opacity: 0.7;
	}

	.mode-btn.active svg {
		opacity: 1;
	}

	.chart-title-group {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.chart-header h2 {
		font-family: var(--font-serif);
		font-size: 20px;
		font-weight: 400;
		color: var(--color-text);
		margin: 0;
		letter-spacing: 0.02em;
		line-height: 1.2;
	}

	.scientific-name {
		font-size: 13px;
		color: var(--color-text-dim);
		font-style: italic;
		margin: 0;
		line-height: 1.2;
	}

	.chart-description {
		font-size: 13px;
		color: var(--color-text-dim);
		margin: 0;
		line-height: 1.2;
	}

	.chart-wrapper {
		flex: 1;
		min-height: 0;
		position: relative;
	}

	.species-image-overlay {
		position: absolute;
		bottom: 5px;
		right: 16px;
		z-index: 5;
		pointer-events: none;
		animation: fadeInImage 0.4s ease-out;
	}

	.species-image-overlay img {
		width: 120px;
		height: 120px;
		object-fit: contain;
		opacity: 1.0;
		filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.4));
	}

	@keyframes fadeInImage {
		from { opacity: 0; transform: scale(0.9); }
		to { opacity: 1; transform: scale(1); }
	}

	/* Legend section */
	.legend-section {
		flex-shrink: 0;
	}

	/* Large screens (1920px+) */
	@media (min-width: 1600px) {
		.app-container {
			max-width: 1500px;
			padding: 40px 48px;
			gap: 20px;
			height: 100vh;
		}

		header {
			padding: 20px 0 16px 0;
		}

		.pre-title {
			font-size: 16px;
		}

		h1 {
			font-size: 32px;
		}

		.sub-title {
			font-size: 15px;
			margin-top: 8px;
		}

		.stat-value {
			font-size: 24px;
		}

		.stat-label {
			font-size: 11px;
		}

		.stats {
			gap: 40px;
		}

		.chart-section {
			padding: 24px 32px 8px 32px;
			border-radius: 16px;
			/* allow flex to size this based on available container height */
			max-height: none;
		}

		.chart-header h2 {
			font-size: 22px;
		}

		.scientific-name,
		.chart-description {
			font-size: 14px;
		}
	}

	/* Extra large screens (2K+) */
	@media (min-width: 1920px) {
		.app-container {
			max-width: 1600px;
			padding: 48px 64px;
		}

		.pre-title {
			font-size: 17px;
		}

		h1 {
			font-size: 36px;
		}

		.sub-title {
			font-size: 16px;
		}

		.stat-value {
			font-size: 26px;
		}

		.stat-label {
			font-size: 12px;
		}
	}

	/* Mobile/Desktop visibility */
	.mobile-only {
		display: none;
	}

	.desktop-only {
		display: flex;
	}

	@media (max-width: 768px) {
		.desktop-only {
			display: none !important;
		}

		.mobile-only {
			display: flex !important;
		}
	}

	@media (min-width: 769px) {
		.mobile-sheet {
			display: none !important;
		}
	}

	/* ========================================
	   MOBILE LAYOUT STYLES
	   ======================================== */
	
	.mobile-app {
		display: flex;
		flex-direction: column;
		height: 100vh;
		height: 100dvh;
		overflow: hidden;
		background: var(--color-bg);
	}

	/* Mobile Header */
	.mobile-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		padding: 30px 16px 16px;
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.mobile-header-right {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 8px;
	}

	.mobile-title-block {
		display: flex;
		flex-direction: column;
		gap: 0;
		line-height: 1;
	}

	.mobile-pre-title {
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 12px;
		color: var(--color-text-muted);
		letter-spacing: 0.05em;
		margin-bottom: 1px;
	}

	.mobile-main-title {
		font-family: var(--font-serif);
		font-size: 20px;
		font-weight: 400;
		color: var(--color-text);
		margin: 0;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		line-height: 1;
	}

	.mobile-sub-title {
		font-family: var(--font-sans);
		font-size: 11px;
		font-weight: 500;
		color: var(--color-text-muted);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		margin-top: 4px;
		margin-bottom: 8px;
	}

	.mobile-stats {
		display: flex;
		gap: 24px;
	}

	.mobile-stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
	}

	.mobile-stat-value {
		font-size: 16px;
		font-weight: 600;
		color: var(--color-text);
		letter-spacing: -0.02em;
	}

	.mobile-stat-label {
		font-size: 9px;
		font-weight: 500;
		color: var(--color-text-dim);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	/* Mobile Chart Section */
	.mobile-chart-section {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		padding: 12px 12px 12px;
		max-height: calc(100vh - 220px);
		gap: 8px;
	}

	.mobile-chart-section.stream-view {
		padding: 12px 4px 12px;
	}

	/* Species Info Bar (when species selected) */
	.mobile-species-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 0 4px;
		flex-shrink: 0;
	}

	.mobile-species-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.mobile-chart-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		flex-shrink: 0;
		padding: 0 8px;
	}

	.mobile-chart-section.stream-view .mobile-chart-header {
		padding: 0 8px;
	}

	.mobile-chart-title {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.mobile-chart-title h2 {
		font-family: var(--font-serif);
		font-size: 18px;
		font-weight: 400;
		color: var(--color-text);
		margin: 0;
		line-height: 1.2;
	}

	.mobile-scientific {
		font-size: 12px;
		color: var(--color-text-dim);
		font-style: italic;
		line-height: 1.2;
		margin-bottom: 5px;
	}

	/* Mobile View Mode Toggle */
	.mobile-view-toggle {
		display: flex;
		justify-content: center;
		gap: 4px;
		padding: 0 12px 10px;
		flex-shrink: 0;
	}

	.mobile-mode-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 18px;
		border-radius: 20px;
		border: none;
		background: rgba(255, 255, 255, 0.06);
		color: rgba(255, 255, 255, 0.45);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.mobile-mode-btn:active {
		transform: scale(0.97);
	}

	.mobile-mode-btn.active {
		background: rgba(255, 255, 255, 0.12);
		color: rgba(255, 255, 255, 0.95);
	}

	.mobile-mode-btn svg {
		flex-shrink: 0;
		opacity: 0.7;
	}

	.mobile-mode-btn.active svg {
		opacity: 1;
	}

	/* Mobile Toggle Pills */
	.mobile-toggles-row {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		flex-shrink: 0;
	}

	.mobile-pill {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 5px 10px;
		border-radius: 14px;
		border: none;
		background: rgba(255, 255, 255, 0.06);
		color: rgba(255, 255, 255, 0.45);
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.mobile-pill:active {
		transform: scale(0.97);
	}

	.mobile-pill.active {
		background: rgba(255, 255, 255, 0.12);
		color: rgba(255, 255, 255, 0.95);
	}

	.mobile-pill.temp.active {
		background: rgba(239, 68, 68, 0.15);
		color: #fca5a5;
	}

	.mobile-pill.precip.active {
		background: rgba(59, 130, 246, 0.15);
		color: #93c5fd;
	}

	.mobile-pill.ndvi.active {
		background: rgba(34, 197, 94, 0.15);
		color: #86efac;
	}

	.mobile-pill svg {
		flex-shrink: 0;
	}

	.mobile-pill span {
		white-space: nowrap;
	}

	/* Mobile Species Image */
	.mobile-species-image {
		flex-shrink: 0;
		width: 64px;
		height: 64px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: var(--species-color);
		opacity: 0.8;
	}

	.mobile-species-image img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.35));
		transform: scale(1.2);
	}

	/* Mobile Chart Wrapper */
	.mobile-chart-wrapper {
		flex: 1;
		min-height: 0;
		position: relative;
		background: var(--color-bg-elevated);
		border-radius: 12px;
		border: 1px solid var(--color-border-subtle);
		overflow: hidden;
	}

	.mobile-chart-wrapper.stream-view {
		border-radius: 0;
		border-left: none;
		border-right: none;
	}

	/* Mobile Bottom Sheet */
	.mobile-sheet {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		background: var(--color-bg-elevated);
		border-top-left-radius: 20px;
		border-top-right-radius: 20px;
		box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.4);
		transform: translateY(calc(100% - 72px));
		transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1);
		z-index: 100;
		max-height: 70vh;
		display: flex;
		flex-direction: column;
	}

	.mobile-sheet.open {
		transform: translateY(0);
	}

	.sheet-handle {
		width: 100%;
		padding: 16px;
		background: none;
		border: none;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		flex-shrink: 0;
		border-radius: 20px 20px 0 0;
		transition: background-color 0.2s ease;
	}

	.sheet-handle:hover {
		background: rgba(255, 255, 255, 0.05);
	}

	.sheet-peek {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		justify-content: center;
	}

	.peek-image {
		width: 32px;
		height: 32px;
		object-fit: contain;
		border-radius: 50%;
	}

	.peek-dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
	}

	.peek-text {
		font-size: 15px;
		font-weight: 500;
		color: var(--color-text);
	}

	.sheet-chevron {
		color: rgba(255, 255, 255, 0.5);
		transition: transform 0.3s ease;
	}

	.mobile-sheet.open .sheet-chevron {
		transform: rotate(180deg);
	}

	/* Sheet Content */
	.sheet-content {
		flex: 1;
		overflow-y: auto;
		padding: 8px 16px 24px;
		-webkit-overflow-scrolling: touch;
	}

	.species-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		gap: 12px;
	}

	.species-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 12px 8px;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 12px;
		border: 1px solid transparent;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.species-card:active {
		transform: scale(0.97);
	}

	.species-card.active {
		background: rgba(255, 255, 255, 0.12);
		border-color: rgba(255, 255, 255, 0.2);
	}

	.card-icon {
		position: relative;
		width: 48px;
		height: 48px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.card-icon::before {
		content: '';
		position: absolute;
		width: 40px;
		height: 40px;
		background: var(--species-color);
		border-radius: 50%;
		opacity: 0.8;
	}

	.card-icon img {
		width: 48px;
		height: 48px;
		object-fit: contain;
		position: relative;
		z-index: 1;
		filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
	}

	.card-dot {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--species-color);
		position: relative;
		z-index: 1;
		box-shadow: 0 0 8px var(--species-color);
	}

	.card-name {
		font-size: 12px;
		font-weight: 500;
		color: rgba(255, 255, 255, 0.85);
		text-align: center;
		line-height: 1.2;
	}

	.species-card.active .card-name {
		color: var(--color-text);
	}

	/* Mobile Backdrop */
	.mobile-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 99;
		border: none;
		cursor: pointer;
		animation: fadeIn 0.2s ease-out;
	}
</style>
