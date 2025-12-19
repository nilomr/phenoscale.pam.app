<script lang="ts">
	import type { Species } from './types';
	import { getCommonName, getSpeciesData } from './types';
	import * as d3 from 'd3';

	interface Props {
		species: Species[];
		selectedSpecies: string | null;
		onSelect: (name: string | null) => void;
		colorScale: d3.ScaleOrdinal<string, string>;
		birdData: Record<string, {common_name: string, species_code: string}> | null;
		imageMap: Record<string, string>;
	}

	let { species, selectedSpecies, onSelect, colorScale, birdData, imageMap }: Props = $props();

	function handleSelect(name: string) {
		if (selectedSpecies === name) {
			onSelect(null);
		} else {
			onSelect(name);
		}
	}

	// Sort by total detections
	const sortedSpecies = $derived(
		[...species].sort((a, b) => b.total - a.total)
	);
</script>

<div class="legend-row">
	{#each sortedSpecies as sp (sp.name)}
		{@const isActive = selectedSpecies === sp.name}
		{@const isDimmed = selectedSpecies !== null && !isActive}
		{@const speciesData = getSpeciesData(sp.name, birdData)}
		{@const speciesCode = speciesData?.species_code}
		{@const imageSrc = speciesCode ? imageMap[speciesCode] : null}
		{@const commonName = getCommonName(sp.name, birdData)}
		{@const nameParts = commonName.split(' ')}
		{@const firstLine = nameParts.slice(0, 1).join(' ')}
		{@const secondLine = nameParts.slice(1).join(' ')}
		<button
			class="legend-item"
			class:active={isActive}
			class:dimmed={isDimmed}
			onclick={() => handleSelect(sp.name)}
		>
			<div class="bird-icon" style="--species-color: {colorScale(sp.name)}">
				{#if imageSrc}
					<img src={imageSrc} alt={commonName} />
				{:else}
					<div class="color-dot"></div>
				{/if}
			</div>
			<div class="species-name-container">
				<span class="species-name-line">{firstLine}</span>
				{#if secondLine}
					<span class="species-name-line">{secondLine}</span>
				{/if}
			</div>
		</button>
	{/each}
</div>

<style>
	.legend-row {
		display: flex;
		justify-content: center;
		gap: 24px;
		padding: 12px 8px 16px;
		flex-wrap: wrap;
		position: relative;
	}

	.legend-row::before {
		content: '';
		position: absolute;
		top: 48px;
		left: 80px;
		right: 80px;
		height: 1px;
		background: rgba(255, 255, 255, 0.15);
		pointer-events: none;
		z-index: 0;
	}

	.legend-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 8px 10px 6px;
		background: transparent;
		border: none;
		cursor: pointer;
		transition: opacity 0.15s ease-out, transform 0.15s ease-out;
	}

	.legend-item:hover {
		transform: translateY(-2px);
	}

	.legend-item.dimmed {
		filter: brightness(0.4) saturate(0.2);
	}

	.legend-item.active {
		opacity: 1;
	}

	.legend-item:focus {
		outline: none;
	}


	.bird-icon {
		position: relative;
		width: 56px;
		height: 56px;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden; /* clip the image to the circular container */
		border-radius: 50%;
	}

	.bird-icon::before {
		content: '';
		position: absolute;
		width: 44px;
		height: 44px;
		background: var(--species-color);
		border-radius: 50%;
		transition: all 0.15s ease-out;
	}

	.legend-item:hover .bird-icon::before,
	.legend-item.active .bird-icon::before {
		transform: scale(1.1);
		background: var(--species-color);
	}

	/* Place the illustration above the circular background and allow it to overflow */
	.bird-icon {
		overflow: visible; /* allow bird to extend over the circle */
	}

	.bird-icon::before {
		z-index: 0; /* background circle */
	}

	.bird-icon img {
		/* make all illustrations the same size square */
		width: 56px;
		height: 56px;
		object-fit: contain;
		position: relative;
		z-index: 1; /* above the ::before circle */
		filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.35));
		transition: transform 0.15s ease-out;
		/* compositing hints to reduce scaling artifacts */
		transform-origin: center center;
		backface-visibility: hidden;
		will-change: transform;
	}

	.legend-item:hover .bird-icon img,
	.legend-item.active .bird-icon img {
		transform: scale(1.06);
	}

	.color-dot {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--species-color);
		position: relative;
		z-index: 1;
		box-shadow: 0 0 8px var(--species-color);
		transition: transform 0.15s ease-out, box-shadow 0.15s ease-out;
	}

	.legend-item.active .color-dot {
		transform: scale(1.2);
		box-shadow: 0 0 16px var(--species-color);
	}

	.species-name-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		line-height: 1.15;
		max-width: 90px;
		padding-top: 0px;
	}

	.species-name-line {
		font-size: 11px;
		letter-spacing: 0.01em;
		font-weight: 400;
		color: rgba(255, 255, 255, 0.85);
		text-align: center;
		transition: color 0.15s ease-out;
		line-height: 1.2;
	}

	.legend-item.active .species-name-line {
		color: rgba(255, 255, 255, 1);
		font-weight: 500;
	}

	@media (max-width: 600px) {
		.legend-row {
			gap: 16px;
			padding: 10px 4px 14px;
		}

		.bird-icon {
			width: 44px;
			height: 44px;
		}

		.bird-icon::before {
			width: 36px;
			height: 36px;
		}

		.bird-icon img {
			width: 44px;
			height: 44px;
			object-fit: contain;
			max-width: none;
		}

		.color-dot {
			width: 12px;
			height: 12px;
		}

		.species-name-line {
			font-size: 10px;
		}
	}
</style>
