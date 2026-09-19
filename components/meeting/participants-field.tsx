"use client";

import { Plus, Trash2, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface ParticipantDraft {
  key: string;
  display_name: string;
  position: string;
  is_me: boolean;
  person_id: string | null;
}

export interface KnownPerson {
  id: string;
  full_name: string;
  position: string | null;
  company_name: string | null;
}

export function newParticipant(partial: Partial<ParticipantDraft> = {}): ParticipantDraft {
  return {
    key: crypto.randomUUID(),
    display_name: "",
    position: "",
    is_me: false,
    person_id: null,
    ...partial,
  };
}

/**
 * The participant list is the single most valuable input the user gives us.
 * It is what the speaker-mapping step matches diarization labels against, and
 * what lets the report spell names correctly even when the transcript did not.
 */
export function ParticipantsField({
  value,
  onChange,
  knownPeople,
}: {
  value: ParticipantDraft[];
  onChange: (value: ParticipantDraft[]) => void;
  knownPeople: KnownPerson[];
}) {
  function update(key: string, patch: Partial<ParticipantDraft>) {
    onChange(value.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function setMe(key: string) {
    // exactly one "this is me"
    onChange(value.map((p) => ({ ...p, is_me: p.key === key })));
  }

  return (
    <div className="space-y-3">
      {value.map((p, index) => (
        <div key={p.key} className="rounded-lg border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor={`name-${p.key}`} className="text-xs">
                Name
              </Label>
              <div className="flex gap-1.5">
                <Input
                  id={`name-${p.key}`}
                  value={p.display_name}
                  placeholder="Mr Tan"
                  onChange={(e) =>
                    update(p.key, { display_name: e.target.value, person_id: null })
                  }
                />
                {knownPeople.length > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Link to someone you already know"
                      >
                        <User className="size-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search people…" />
                        <CommandList>
                          <CommandEmpty>Nobody found.</CommandEmpty>
                          <CommandGroup>
                            {knownPeople.map((person) => (
                              <CommandItem
                                key={person.id}
                                value={`${person.full_name} ${person.company_name ?? ""}`}
                                onSelect={() =>
                                  update(p.key, {
                                    display_name: person.full_name,
                                    position: person.position ?? "",
                                    person_id: person.id,
                                  })
                                }
                              >
                                <div>
                                  <p className="text-sm">{person.full_name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {[person.position, person.company_name]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </p>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`position-${p.key}`} className="text-xs">
                Position
              </Label>
              <Input
                id={`position-${p.key}`}
                value={p.position}
                placeholder="COO"
                onChange={(e) => update(p.key, { position: e.target.value })}
              />
            </div>

            <div className="flex items-end pb-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove participant ${index + 1}`}
                disabled={value.length === 1}
                onClick={() => onChange(value.filter((x) => x.key !== p.key))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Switch
              id={`me-${p.key}`}
              checked={p.is_me}
              onCheckedChange={() => setMe(p.key)}
            />
            <Label htmlFor={`me-${p.key}`} className="text-sm font-normal">
              This is me
            </Label>
            {p.person_id && (
              <span className="ml-auto text-xs text-muted-foreground">
                Linked to an existing contact
              </span>
            )}
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        onClick={() => onChange([...value, newParticipant()])}
      >
        <Plus className="size-4" />
        Add participant
      </Button>
    </div>
  );
}
