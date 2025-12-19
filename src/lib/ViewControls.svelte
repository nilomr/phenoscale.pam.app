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
	}

	let { 
		showSiteLines, 
		onToggleSiteLines, 
		siteCount, 
		selectedSpecies,
		showTemperature = false,
		onToggleTemperature,
		showPrecipitation = false,
		onTogglePrecipitation
	}: Props = $props();
</script>

{#if selectedSpecies}
	<div class="view-controls">
		<label class="toggle-control">
			<input type="checkbox" checked={showSiteLines} onchange={onToggleSiteLines} />
			<span class="toggle-track">
				<span class="toggle-thumb"></span>
			</span>
			<span class="toggle-label">
				{siteCount} sites
			</span>
		</label>

		{#if onToggleTemperature}
			<label class="toggle-control">
				<input type="checkbox" checked={showTemperature} onchange={onToggleTemperature} />
				<span class="toggle-track temp">
					<span class="toggle-thumb"></span>
				</span>
				<span class="toggle-label">Temperature</span>
			</label>
		{/if}

		{#if onTogglePrecipitation}
			<label class="toggle-control">
				<input type="checkbox" checked={showPrecipitation} onchange={onTogglePrecipitation} />
				<span class="toggle-track precip">
					<span class="toggle-thumb"></span>
				</span>
				<span class="toggle-label">Precipitation</span>
			</label>
		{/if}
	</div>
{/if}

<style>
	.view-controls {
		display: flex;
		align-items: center;
		gap: 16px;
	}

	.toggle-control {
		display: flex;
		align-items: center;
		gap: 12px;
		cursor: pointer;
		user-select: none;
	}

	.toggle-control input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}

	.toggle-track {
		position: relative;
		width: 40px;
		height: 22px;
		background: rgba(255, 255, 255, 0.15);
		border-radius: 11px;
		transition: background 0.2s ease;
	}

	.toggle-control input:checked + .toggle-track {
		background: rgba(255, 255, 255, 0.35);
	}

	.toggle-control input:checked + .toggle-track.temp {
		background: rgba(255, 107, 53, 0.5);
	}

	.toggle-control input:checked + .toggle-track.precip {
		background: rgba(96, 165, 250, 0.5);
	}

	.toggle-thumb {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 16px;
		height: 16px;
		background: rgba(255, 255, 255, 0.9);
		border-radius: 50%;
		transition: transform 0.2s ease;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
	}

	.toggle-control input:checked + .toggle-track .toggle-thumb {
		transform: translateX(18px);
	}

	.toggle-label {
		font-size: 13px;
		color: rgba(255, 255, 255, 0.7);
		font-weight: 500;
		letter-spacing: 0.01em;
	}
</style>
