import { appInfo } from "../properties";
import { AppConfig, WinStateKeeper } from "../config";
import { app, BrowserWindow, shell, Tray } from "electron";
import * as getMenu from '../menus';
import { packageJson, discordFavicons } from '../../global';
import { discordContentSecurityPolicy } from '../csp';
import TranslatedStrings from "../lang";
import { getUserAgent } from '../../internalModules/userAgent';
import { createHash } from 'crypto';


const configData = (new AppConfig().get());

export default function createMainWindow(startHidden: boolean, l10nStrings: TranslatedStrings): BrowserWindow {

    // Some variable declarations

    let tray: Promise<Tray>;

    // Check the window state

    const mainWindowState = new WinStateKeeper('mainWindow')

    // Browser window

    const win = new BrowserWindow({
        title: app.getName(),
        minWidth: appInfo.minWinWidth,
        minHeight: appInfo.minWinHeight,
        height: mainWindowState.initState.height,
        width: mainWindowState.initState.width,
        backgroundColor: "#36393F",
        icon: appInfo.icon,
        show: false,
        webPreferences: {
            enableRemoteModule: false,
            preload: app.getAppPath() + "/sources/app/renderer/preload/mainWindow.js",
            nodeIntegration: false, // Won't work with the true value.
            devTools: true, // Too usefull to be blocked.
            contextIsolation: false // Disabled because of the capturer.
        }
    });

    if(mainWindowState.initState.isMaximized) win.maximize()
    if(!startHidden) win.show()

    // CSP

    if (!configData.csp.disabled) {
        win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
            callback({
                responseHeaders: {
                    ...details.responseHeaders,
                    'Content-Security-Policy': [discordContentSecurityPolicy]
                }
            });
        });
    }
    const childCsp = "default-src 'self' blob:";

    // Permissions:
    {
        /** List of domains, urls or protocols accepted by permission handlers. */
        const trustedURLs = [
            appInfo.rootURL,
            'devtools://'
        ];
        win.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
            let websiteURL: string;
            (webContents !== null && webContents.getURL() !== "") ? websiteURL = webContents.getURL() : websiteURL = requestingOrigin;
            // In some cases URL might be empty string, it should be denied then for that reason.
            if (websiteURL === "")
                return false;
            const originURL = new URL(websiteURL).origin;
            for (const secureURL of trustedURLs) {
                if (originURL.startsWith(secureURL)) {
                    return true;
                }
            }
            console.warn(`[${l10nStrings.dialog.warning.toLocaleUpperCase()}] ${l10nStrings.dialog.permission.check.denied}`, originURL, permission);
            return false;
        });
        win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
            for (const secureURL of trustedURLs) {
                if (webContents.getURL().startsWith(secureURL)) {
                    return callback(true);
                }
            }
            console.warn(`[${l10nStrings.dialog.warning.toLocaleUpperCase()}] ${l10nStrings.dialog.permission.request.denied}`, webContents.getURL(), permission);
            return callback(false);
        });
    }
    win.loadURL(appInfo.URL, { userAgent: getUserAgent(process.versions.chrome) });
    win.setAutoHideMenuBar(configData.hideMenuBar);
    win.setMenuBarVisibility(!configData.hideMenuBar);

    // Keep window state

    mainWindowState.watchState(win);

    // Load all menus:

    getMenu.context(win);
    if (!configData.disableTray) tray = getMenu.tray(win, childCsp);
    getMenu.bar(packageJson.repository.url, win);

    // Open external URLs in default browser
    {
        win.webContents.setWindowOpenHandler((details) => {
            /**
             * Allowed protocol list.
             * 
             * For security reasons, `shell.openExternal()` should not be used for any type
             * of the link, as this may allow potential attackers to compromise host or even
             * execute arbitary commands.
             * 
             * See:
             * https://www.electronjs.org/docs/tutorial/security#14-do-not-use-openexternal-with-untrusted-content
             */
            const trustedProtocolArray = [
                'https://',
                'mailto:'
            ];
            for (const protocol of trustedProtocolArray) {
                if (details.url.startsWith(protocol)) shell.openExternal(details.url);
            }
            return { action: 'deny' };
        });
    }

    // "Red dot" icon feature

    win.webContents.once('did-finish-load', () => {
        win.webContents.on('page-favicon-updated', async (event, favicons) => {
            const t = await tray;

            // Hash discord favicon.
            const faviconHash = createHash('sha1');
            faviconHash.update(favicons[0]);
            
            // Compare hashes.
            if (!configData.disableTray) switch (faviconHash.digest('hex')) {
                case discordFavicons.default:
                case discordFavicons.unread:
                    t.setImage(appInfo.trayIcon);
                break;
                default:
                    t.setImage(appInfo.trayPing);
            }   
        });
    });

    // Window Title

    win.on('page-title-updated', (event: Event, title: string) => {
        if (title == "Discord") {
            event.preventDefault();
            win.setTitle(app.getName());
        }
    });

    // Animate menu

    win.webContents.on('did-finish-load', () => {
        win.webContents.insertCSS(".sidebar-2K8pFh{ transition: width .1s; transition-timing-function: linear;}");
    });

    return win;
}