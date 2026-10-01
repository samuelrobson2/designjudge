import type { Packet } from '../categories/types.ts';

// What `npm run publish` bundles with the hosted ratings function: where to save ratings and,
// for each interface, the evidence packet a rating is validated against and the judge scores
// shown after rating.
export interface HostedKit {
  // Where ratings are committed: `dir` in `repo` on `branch`.
  github: { repo: string; branch: string; dir: string };
  cases: Record<
    string,
    {
      latestBundleId: string;
      judge: unknown[];
      bundles: Record<
        string,
        {
          interfaceId: string;
          versions: Record<string, { promptHash: string; packetHash: string; packet: Packet; request: unknown }>;
        }
      >;
    }
  >;
}
