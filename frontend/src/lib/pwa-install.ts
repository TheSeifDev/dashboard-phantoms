/** Prevent the browser's generic web-app install prompt from competing with the APK flow. */
export function preventBrowserInstallPrompt(event: Event): void {
  event.preventDefault();
}

/** Install the guard once at application boot so it covers public, login, and authenticated routes. */
export function installBrowserInstallPromptGuard(target: Pick<Window, 'addEventListener'> = window): void {
  target.addEventListener('beforeinstallprompt', preventBrowserInstallPrompt);
}
