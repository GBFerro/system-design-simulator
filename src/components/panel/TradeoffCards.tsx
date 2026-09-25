"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TRADEOFF_CARDS } from "@/data/tradeoffCards";

export function TradeoffCards() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggle = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Reference Cards
      </p>
      <div className="space-y-1.5">
        {TRADEOFF_CARDS.map((card) => {
          const isOpen = expandedId === card.id;
          return (
            <div
              key={card.id}
              className="rounded-md border border-zinc-700 bg-zinc-800 overflow-hidden"
            >
              <button
                onClick={() => toggle(card.id)}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
              >
                {isOpen ? (
                  <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0 text-zinc-500" />
                )}
                <span className="flex-1 text-xs font-medium text-zinc-300">{card.title}</span>
              </button>

              {isOpen && (
                <div className="border-t border-zinc-700 px-2.5 py-2.5 space-y-3">
                  {/* Side-by-side options. min-w-0 lets the grid tracks shrink
                      (grid items default to min-width:auto), and break-words
                      wraps long option names so nothing overflows the panel. */}
                  <div className="grid grid-cols-2 gap-2">
                    {/* Option A */}
                    <div className="min-w-0 space-y-1.5">
                      <p className="break-words text-[11px] font-semibold text-cyan-400">
                        {card.optionA.name}
                      </p>
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wider text-emerald-500">
                          Pros
                        </p>
                        <ul className="mt-0.5 space-y-0.5">
                          {card.optionA.pros.map((pro, i) => (
                            <li
                              key={i}
                              className="break-words text-[11px] leading-tight text-zinc-400"
                            >
                              + {pro}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wider text-rose-500">
                          Cons
                        </p>
                        <ul className="mt-0.5 space-y-0.5">
                          {card.optionA.cons.map((con, i) => (
                            <li
                              key={i}
                              className="break-words text-[11px] leading-tight text-zinc-500"
                            >
                              - {con}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {/* Option B */}
                    <div className="min-w-0 space-y-1.5">
                      <p className="break-words text-[11px] font-semibold text-purple-400">
                        {card.optionB.name}
                      </p>
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wider text-emerald-500">
                          Pros
                        </p>
                        <ul className="mt-0.5 space-y-0.5">
                          {card.optionB.pros.map((pro, i) => (
                            <li
                              key={i}
                              className="break-words text-[11px] leading-tight text-zinc-400"
                            >
                              + {pro}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wider text-rose-500">
                          Cons
                        </p>
                        <ul className="mt-0.5 space-y-0.5">
                          {card.optionB.cons.map((con, i) => (
                            <li
                              key={i}
                              className="break-words text-[11px] leading-tight text-zinc-500"
                            >
                              - {con}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>

                  {/* When to choose */}
                  <div className="space-y-1.5 border-t border-zinc-700 pt-2">
                    <div>
                      <p className="text-[10px] font-medium text-cyan-500">
                        Choose {card.optionA.name} when:
                      </p>
                      <p className="text-[11px] leading-relaxed text-zinc-400">
                        {card.whenToChooseA}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium text-purple-500">
                        Choose {card.optionB.name} when:
                      </p>
                      <p className="text-[11px] leading-relaxed text-zinc-400">
                        {card.whenToChooseB}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
