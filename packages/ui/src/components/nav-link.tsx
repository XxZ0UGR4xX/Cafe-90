import { type AnchorHTMLAttributes, type ReactNode, createContext, useContext } from 'react';

/** Adaptador de enlaces de navegación: la app inyecta el NavLink de su router (el UI no depende del router). */
export type LinkImpl = (props: { to: string; className?: string; children: ReactNode; title?: string }) => ReactNode;
export const LinkContext = createContext<LinkImpl>(({ to, children, ...r }) => <a href={to} {...(r as AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>);
export function NavLink(props: { to: string; title?: string; children: ReactNode }) {
  const Impl = useContext(LinkContext);
  return <>{Impl(props)}</>;
}
