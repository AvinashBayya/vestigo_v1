import { cn } from "./cn.ts";

/** The classes of entity the platform records, as the API names them. */
export const ENTITY_CLASSES = [
  "PERSON",
  "ORGANIZATION",
  "DOMAIN",
  "IP_ADDRESS",
  "EMAIL_ADDRESS",
  "USERNAME",
  "PHONE_NUMBER",
  "URL",
  "SOCIAL_ACCOUNT",
  "LOCATION",
] as const;
export type EntityClass = (typeof ENTITY_CLASSES)[number];

/** Each class in words, as it is written on a node and in every list. */
export const ENTITY_CLASS_LABEL: Readonly<Record<EntityClass, string>> = {
  PERSON: "Person",
  ORGANIZATION: "Organisation",
  DOMAIN: "Domain",
  IP_ADDRESS: "IP address",
  EMAIL_ADDRESS: "Email",
  USERNAME: "Username",
  PHONE_NUMBER: "Phone",
  URL: "URL",
  SOCIAL_ACCOUNT: "Account",
  LOCATION: "Location",
};

/** The design system's token name for each class (§2, Entity class). */
export const ENTITY_CLASS_TOKEN: Readonly<Record<EntityClass, string>> = {
  PERSON: "person",
  ORGANIZATION: "organisation",
  DOMAIN: "domain",
  IP_ADDRESS: "ip",
  EMAIL_ADDRESS: "email",
  USERNAME: "username",
  PHONE_NUMBER: "phone",
  URL: "url",
  SOCIAL_ACCOUNT: "account",
  LOCATION: "location",
};

/** Ring colour as a background, for the dot beside a class name. */
export const ENTITY_CLASS_DOT: Readonly<Record<EntityClass, string>> = {
  PERSON: "bg-entity-person-ring",
  ORGANIZATION: "bg-entity-organisation-ring",
  DOMAIN: "bg-entity-domain-ring",
  IP_ADDRESS: "bg-entity-ip-ring",
  EMAIL_ADDRESS: "bg-entity-email-ring",
  USERNAME: "bg-entity-username-ring",
  PHONE_NUMBER: "bg-entity-phone-ring",
  URL: "bg-entity-url-ring",
  SOCIAL_ACCOUNT: "bg-entity-account-ring",
  LOCATION: "bg-entity-location-ring",
};

/** An entity's class: its colour dot and, always, its name (§6). */
export function EntityClassName({
  entityClass,
  className,
}: {
  readonly entityClass: EntityClass;
  readonly className?: string | undefined;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.75 whitespace-nowrap", className)}>
      <span
        aria-hidden="true"
        className={cn("size-dot shrink-0 rounded-pill", ENTITY_CLASS_DOT[entityClass])}
      />
      {ENTITY_CLASS_LABEL[entityClass]}
    </span>
  );
}
