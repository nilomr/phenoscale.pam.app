<script lang="ts">
	interface Props {
		showSiteLines: boolean;
		onToggleSiteLines: () => void;
		siteCount: number;
		selectedSpecies: string | null;
		showTemperature?: boolean;
		onToggleTemperature?: () => void;
		showPrecipitation?: boolean;
		onTogglePrecipitation?: () => void;
		showNdvi?: boolean;
		onToggleNdvi?: () => void;
	}

	let { 
		showSiteLines, 
		onToggleSiteLines, 
		siteCount, 
		selectedSpecies,
		showTemperature = false,
		onToggleTemperature,
		showPrecipitation = false,
		onTogglePrecipitation,
		showNdvi = false,
		onToggleNdvi
	}: Props = $props();
</script>

{#if selectedSpecies}
	<div class="view-controls">
		<button 
			class="control-btn" 
			class:active={showSiteLines}
			onclick={onToggleSiteLines}
			title="{siteCount} sites"
		>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="12" cy="12" r="2"/>
				<circle cx="6" cy="6" r="1.5"/>
				<circle cx="18" cy="6" r="1.5"/>
				<circle cx="6" cy="18" r="1.5"/>
				<circle cx="18" cy="18" r="1.5"/>
				<path d="M6 6l6 6m0 0l6-6m-6 6l-6 6m6-6l6 6" opacity="0.5"/>
			</svg>
			<span>Sites</span>
		</button>

		{#if onToggleTemperature}
			<button 
				class="control-btn temp" 
				class:active={showTemperature}
				onclick={onToggleTemperature}
				title="Temperature"
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>
					<circle cx="11.5" cy="17.5" r="1.5" fill="currentColor"/>
				</svg>
				<span>Temp</span>
			</button>
		{/if}

		{#if onTogglePrecipitation}
			<button 
				class="control-btn precip" 
				class:active={showPrecipitation}
				onclick={onTogglePrecipitation}
				title="Precipitation"
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
				</svg>
				<span>Rain</span>
			</button>
		{/if}

		{#if onToggleNdvi}
			<button 
				class="control-btn ndvi" 
				class:active={showNdvi}
				onclick={onToggleNdvi}
				title="NDVI"
			>
				<!-- Tree icon for NDVI -->
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M12 2c2.2 0 4 1.8 4 4 0 .5-.1 1-.3 1.4 1.3.1 2.5.6 3.4 1.6 1 1 1 2.6 0 3.6-1 1-2.6 1-3.6 0-.7-.7-1.7-1.1-2.6-1.1H10.1c-.9 0-1.9.4-2.6 1.1-1 1-2.6 1-3.6 0-1-1-1-2.6 0-3.6.9-1 2.1-1.5 3.4-1.6C7.1 7 7 6.5 7 6c0-2.2 1.8-4 4-4z"/>
					<path d="M12 13v8"/>
					<path d="M9 21h6"/>
				</svg>
				<span>NDVI</span>
			</button>
		{/if}
	</div>
{/if}

<style>
	.view-controls {
		display: flex;
		align-items: center;
		gap: 4px;
		background: rgba(255, 255, 255, 0.04);
		border-radius: 20px;
		padding: 3px;
		border: 1px solid rgba(255, 255, 255, 0.08);
	}

	.control-btn {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 6px 10px;
		border-radius: 16px;
		border: none;
		background: transparent;
		color: rgba(255, 255, 255, 0.45);
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
		user-select: none;
	}

	.control-btn:hover {
		color: rgba(255, 255, 255, 0.7);
		background: rgba(255, 255, 255, 0.04);
	}

	.control-btn.active {
		background: rgba(255, 255, 255, 0.1);
		color: rgba(255, 255, 255, 0.95);
	}

	.control-btn.temp.active {
		background: rgba(239, 68, 68, 0.15);
		color: #fca5a5;
	}

	.control-btn.precip.active {
		background: rgba(59, 130, 246, 0.15);
		color: #93c5fd;
	}

	.control-btn.ndvi.active {
		background: rgba(34, 197, 94, 0.15);
		color: #86efac;
	}

	.control-btn svg {
		flex-shrink: 0;
		opacity: 0.7;
	}

	.control-btn.active svg {
		opacity: 1;
	}
</style>
