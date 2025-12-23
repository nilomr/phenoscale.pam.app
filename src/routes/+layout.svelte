<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link rel="preload" href="https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2" as="font" type="font/woff2" crossorigin />
	<link rel="preload" href="https://fonts.gstatic.com/s/dmseriftext/v13/rnCu-xZa_krGokauCeNq1wWyWfSFXQ.woff2" as="font" type="font/woff2" crossorigin />
	<link rel="preload" href="https://fonts.gstatic.com/s/dmseriftext/v13/rnCw-xZa_krGokauCeNq1wWyWfG1X1oN.woff2" as="font" type="font/woff2" crossorigin />
	<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Text:ital@0;1&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
</svelte:head>

{@render children()}
