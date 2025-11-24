import { createContext } from 'react';
import type { Core } from "@wwwallet/client-core";

const ClientCoreContext = createContext<Core|null>(null);

export default ClientCoreContext;
