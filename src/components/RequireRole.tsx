import { Navigate, Outlet } from 'react-router-dom';
import { getUser } from '../lib/auth';

type Props = {
  allow: string[];
};

export default function RequireRole({ allow }: Props) {
  const user = getUser();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!allow.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
