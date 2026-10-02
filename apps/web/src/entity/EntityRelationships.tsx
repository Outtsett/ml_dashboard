import React from "react";
import { Link } from "wouter";
import { Network } from "lucide-react";
import { EntityRelationship } from "./useEntityProfile";

interface EntityRelationshipsProps {
  relationships: EntityRelationship[];
  currentId: string;
}

export function EntityRelationships({ relationships, currentId }: EntityRelationshipsProps) {
  if (relationships.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-neutral-500 border border-neutral-800 rounded-lg bg-neutral-900/50">
        <Network className="h-8 w-8 mb-3 opacity-20" />
        <p>No relationships found for this entity.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {relationships.map((rel) => {
        const isSource = rel.sourceId === currentId;
        const relatedType = isSource ? rel.targetType : rel.sourceType;
        const relatedId = isSource ? rel.targetId : rel.sourceId;
        const direction = isSource ? "Outgoing" : "Incoming";

        return (
          <Link key={rel.id} href={`/entity/${relatedType}/${relatedId}`}>
            <div className="flex flex-col p-4 border border-neutral-800 rounded-lg bg-neutral-900 hover:bg-neutral-800 cursor-pointer transition-colors group">
              <div className="flex justify-between items-start mb-2">
                <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">{direction}</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">{rel.relationshipType}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded bg-blue-500/10 text-blue-400 flex items-center justify-center border border-blue-500/20 group-hover:border-blue-500/50 transition-colors">
                  {relatedType.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="font-medium text-neutral-200">{relatedId}</div>
                  <div className="text-xs text-neutral-500 capitalize">{relatedType}</div>
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
