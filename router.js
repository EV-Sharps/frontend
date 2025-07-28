function navigateTo(url) {
	history.pushState(null, null, url);
	route();
}

function route() {
	const routes = {
		'/': 'index.html',
		'/daily-dingers': 'dingers.html',
	};

	const path = window.location.pathname;
	const route = routes[path] || 'index.html';

	fetch(route)
		.then(response => response.text())
		.then(html => {
			document.getElementById('content').innerHTML = html;
	});
}
window.onpopstate = route;
window.route = navigateTo;

document.addEventListener('DOMContentLoaded', () => {
	route();
});