export type Role = 'admin' | 'order_taker' | 'store' | 'distributor' | 'stock_keeper';

export type Company = { name: string; address?: string; phone?: string; email?: string };

export type Profile = {
  id: string;
  role: Role;
  full_name: string;
  phone: string;
  customer_id: string | null;
  customer: { id: string; name: string; type: string; city?: string; address?: string; phone?: string } | null;
  company: Company | null;
};

export type Product = {
  id: string;
  name: string;
  pack_size: string | null;
  category: string | null;
  retail_price: number | null;
  net_rate: number;
  packing: string | null;
  image_path: string | null;
  is_active: boolean;
  in_stock: boolean;
  stock_qty: number | null;
  low_stock_level: number | null;
  discount_pct: number;
  price: number;
};

export type Customer = {
  id: string;
  type: string;
  name: string;
  owner_name: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  is_active: boolean;
  default_discount_pct: number;
  credit_days: number | null;
  licence_no: string | null;
  licence_issued?: string | null;
  licence_expiry: string | null;
  licence_expired: boolean | null;
  opening_balance?: number;
  order_taker_id: string | null;
  order_taker_name: string | null;
  balance: number;
  has_login?: boolean;
  overdue_amount?: number;
  open_orders?: number;
  logins?: { id: string; full_name: string; phone: string; is_active: boolean }[] | null;
  lat?: number | null;
  lng?: number | null;
  location_at?: string | null;
  added_by_name?: string | null;
  route_days?: number[];
  has_location?: boolean;
};

export type RoutePlan = {
  user: { id: string; name: string };
  plan: { start_date: string; cycle_days: number; off_day: number | null } | null;
  today: { date: string; day_no: number | null };
  tomorrow: { date: string; day_no: number | null };
  days: { day_no: number; label: string | null; customers: { id: string; name: string; city: string | null; has_location: boolean }[] }[];
  unplanned: number;
};

export type RouteStop = {
  customer_id: string;
  name: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  has_location: boolean;
  visited: boolean;
  visited_at: string | null;
  ordered: boolean;
  order_id: string | null;
  order_total: number | null;
};

export type RouteVisits = {
  user: { id: string; name: string };
  date: string;
  has_plan: boolean;
  day_no: number | null;
  off_day: boolean;
  label: string | null;
  stops: RouteStop[];
  visited: number;
  ordered: number;
  off_route_orders: { customer_id: string; name: string; order_id: string; total: number }[];
};

export type OrderRow = {
  id: string;
  order_no: string;
  status: string;
  total: number;
  returned: number;
  is_opening: boolean;
  due_date: string | null;
  created_at: string;
  delivered_at: string | null;
  customer_id: string;
  customer_name: string;
  customer_type: string;
  city: string | null;
  created_by_name: string;
  created_by_role: string;
  items_count: number;
  paid: number | null;
  remaining: number | null;
  overdue: boolean;
};

export type OrderItem = {
  id: string;
  product_id: string;
  product_name: string;
  qty: number;
  unit_price: number;
  discount_pct: number;
  line_total: number;
  returned_qty: number;
  stock_qty: number | null;
};

export type OrderReturn = {
  id: string;
  return_no: string;
  total: number;
  note: string | null;
  created_at: string;
  by: string | null;
  items: { product_name: string; qty: number; line_total: number }[];
};

export type InvoiceSettings = {
  company: Company | null;
  invoice: { warranty: string | null; signer: string | null; signature: string | null } | null;
  returns: { before_due: boolean } | null;
};

export type OrderDetail = {
  id: string;
  order_no: string;
  status: string;
  is_opening: boolean;
  subtotal: number;
  discount_total: number;
  total: number;
  returned: number;
  opening_paid: number;
  returns: OrderReturn[];
  can_return: boolean;
  return_note: string | null;
  can_deliver: boolean;
  due_date: string | null;
  notes: string | null;
  cancel_reason: string | null;
  created_at: string;
  confirmed_at: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  created_by: string;
  created_by_name: string;
  created_by_role: string;
  customer: {
    id: string;
    name: string;
    type: string;
    phone: string | null;
    address: string | null;
    city: string | null;
    balance: number | null;
    credit_days: number | null;
    licence_no: string | null;
    licence_issued: string | null;
    licence_expiry: string | null;
  };
  items: OrderItem[];
  paid: number | null;
  remaining: number | null;
  history: { action: string; at: string; by: string | null; details: any }[] | null;
};

export type PaymentRow = {
  id: string;
  payment_no: string;
  amount: number;
  method: string;
  status: string;
  paid_on: string;
  created_at: string;
  has_proof: boolean;
  customer_id: string;
  customer_name: string;
  customer_type: string;
  entered_by_name: string;
  entered_by_role: string;
};

export type PaymentDetail = {
  id: string;
  payment_no: string;
  amount: number;
  method: string;
  reference_no: string | null;
  proof_path: string | null;
  note: string | null;
  paid_on: string;
  status: string;
  admin_remarks: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  entered_by_name: string;
  entered_by_role: string;
  order: { id: string; order_no: string; total: number } | null;
  customer: { id: string; name: string; type: string; city: string | null; balance: number };
};

export type LedgerEntry = {
  id: number;
  kind: 'opening' | 'order' | 'payment' | 'adjustment';
  debit: number;
  credit: number;
  note: string | null;
  created_at: string;
  balance: number;
  order_id: string | null;
  payment_id: string | null;
};

export type Ledger = {
  customer: { id: string; name: string; type: string; city: string | null; phone: string | null; address: string | null };
  balance: number;
  total_debit: number;
  total_credit: number;
  entries: LedgerEntry[];
};

export type Notice = {
  id: string;
  title: string;
  body: string;
  kind: string;
  ref_type: string | null;
  ref_id: string | null;
  is_read: boolean;
  created_at: string;
};

export type UserRow = {
  id: string;
  role: Role;
  full_name: string;
  phone: string;
  is_active: boolean;
  customer_id: string | null;
  customer_name: string | null;
  customers_count: number;
};

export type ExpenseItem = { id: string; city?: string; category: string; label: string; amount: number; note: string | null; created_at: string };

export type ExpensesToday = { date: string; city: string | null; total: number; items: ExpenseItem[] };

export type ExpenseReport = {
  from: string;
  to: string;
  total: number;
  by_category: { category: string; label: string; amount: number }[];
  by_user: { user_id: string; name: string; amount: number; tours: number }[];
  by_city: { city: string; tours: number; amount: number; average: number }[];
  tours: { user_id: string; name: string; date: string; city: string; total: number; orders: number; sales: number; items: ExpenseItem[] }[];
};
