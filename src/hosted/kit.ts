import type { Packet } from '../categories/types.ts';

export interface HostedVersion {
  promptHash: string;
  packetHash: string;
  packet: Packet;
  request: unknown;
}

// What `npm run publish` bundles with the hosted ratings function: where to save ratings and,
// for each interface and rating category, the evidence packet a rating is validated against and
// the judge scores shown after rating.
export interface HostedKit {
  // Where ratings are committed: `dir` in `repo` on `branch` (each category but Layout in a subdirectory).
  github: { repo: string; branch: string; dir: string };
  cases: Record<
    string,
    {
      latestBundleId: string;
      // Per category.
      judge: Record<string, unknown[]>;
      bundles: Record<
        string,
        {
          interfaceId: string;
          // Category, then prompt version.
          categories: Record<string, Record<string, HostedVersion>>;
        }
      >;
    }
  >;
}
