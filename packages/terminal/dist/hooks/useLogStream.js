/**
 * useLogStream - Hook for subscribing to log entries
 *
 * Returns the last log entry for display on the dashboard.
 */
import { useState, useEffect } from 'react';
import { isContainerInitialized, getContainer } from '../services/ServiceContainer.js';
/**
 * Subscribe to the UI log stream and return the last entry.
 */
export function useLogStream() {
    const [lastEntry, setLastEntry] = useState(null);
    useEffect(() => {
        if (!isContainerInitialized()) {
            return;
        }
        const container = getContainer();
        const stream = container.uiLogStream;
        // Get current last entry
        setLastEntry(stream.getLastEntry());
        // Subscribe to new entries
        const handleEntry = (entry) => {
            setLastEntry(entry);
        };
        const handleClear = () => {
            setLastEntry(null);
        };
        stream.on('entry', handleEntry);
        stream.on('clear', handleClear);
        return () => {
            stream.off('entry', handleEntry);
            stream.off('clear', handleClear);
        };
    }, []);
    return lastEntry;
}
//# sourceMappingURL=useLogStream.js.map