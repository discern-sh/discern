/**
 * Browser entry for the homepage wall: the one module the site bundles for the
 * browser with a framework runtime. It hydrates the server's markup with the
 * same component and the props the server recorded on the host element.
 * Server and build code never import this module; the site build bundles it.
 */
import { hydrateRoot } from "react-dom/client";
import { decodeWallProps, WALL_HOST_ID, WALL_PROPS_ATTRIBUTE } from "./host.ts";
import { WallPage } from "./WallPage.tsx";

const host = document.getElementById(WALL_HOST_ID);
if (host !== null) {
  hydrateRoot(
    host,
    <WallPage {...decodeWallProps(host.getAttribute(WALL_PROPS_ATTRIBUTE))} />,
  );
}
